package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/rs/zerolog"
	"go.mau.fi/util/exhttp"
	"go.mau.fi/util/ptr"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/instameow/slidetypes"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/dgw"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/methods"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

const (
	stateOff        = "off"
	stateConnecting = "connecting"
	stateOpen       = "open"
	stateError      = "error"
)

// Session is the persisted credential — Core stores it, the sidecar holds it in memory only.
type Session struct {
	Cookies map[string]string `json:"cookies"`
	// Android installation identity from the mobile (CAA) login fallback — reusing
	// it keeps later logins looking like the same device
	Device *types.InstagramLoginDevice `json:"device,omitempty"`
}

type Account struct {
	Username string `json:"username"`
	Name     string `json:"name,omitempty"`
	IGID     string `json:"igid,omitempty"`
	FBID     string `json:"fbid,omitempty"`
}

type Status struct {
	State   string   `json:"state"`
	Error   *errInfo `json:"error,omitempty"`
	Account *Account `json:"account,omitempty"`
	Login   *Step    `json:"login,omitempty"`
}

var (
	errNotConnected = errors.New("instagram não está conectado")
	errUserNotFound = errors.New("usuário do instagram não encontrado")
	errBadUsername  = errors.New("usuário do instagram inválido")
)

type Manager struct {
	cfg  config
	log  zerolog.Logger
	sink *eventSink

	mu            sync.Mutex
	gen           uint64
	client        *instameow.Client
	cancel        context.CancelFunc
	state         string
	lastErr       *errInfo
	account       *Account
	ownFBID       int64
	device        *types.InstagramLoginDevice
	lastCookies   string
	lastInboundMS int64
	groups        map[string]bool

	sendMu   sync.Mutex
	lastSend time.Time

	// loginMu serializes wizard calls (held across Instagram round trips);
	// loginView/loginAt sit under mu so /v1/status never waits on one
	loginMu   sync.Mutex
	login     *loginProc
	loginView *Step
	loginAt   time.Time
}

func newManager(cfg config, log zerolog.Logger, sink *eventSink) *Manager {
	return &Manager{cfg: cfg, log: log, sink: sink, state: stateOff, groups: map[string]bool{}}
}

func (m *Manager) newClient(c *cookies.Cookies, device *types.InstagramLoginDevice, onDevice func(types.InstagramLoginDevice)) (*instameow.Client, error) {
	cli := instameow.NewClient(instameow.ClientParams{
		Cookies:  c,
		Log:      m.log.With().Str("mod", "instameow").Logger(),
		Settings: exhttp.SensibleClientSettings,
		// no typing indicators — skips the extra stream-controller socket
		DisableTyping:     true,
		MobileLoginDevice: device,
		SaveMobileLoginDevice: func(_ context.Context, d types.InstagramLoginDevice) error {
			if onDevice != nil {
				onDevice(d)
			}
			return nil
		},
	})
	if m.cfg.Proxy != "" {
		h := cli.GetHTTP()
		h.GetNewProxy = func(string) (string, error) { return m.cfg.Proxy, nil }
		if !h.UpdateProxy("connect") {
			return nil, errors.New("IG_PROXY inválido")
		}
	}
	return cli, nil
}

func cookiesFrom(values map[string]string) *cookies.Cookies {
	c := &cookies.Cookies{Platform: types.Instagram}
	vals := make(map[cookies.MetaCookieName]string, len(values))
	for k, v := range values {
		vals[cookies.MetaCookieName(k)] = v
	}
	c.UpdateValues(vals)
	return c
}

// Start resumes a stored session; sinceMS (Core's newest instagram inbound) bounds the catch-up.
func (m *Manager) Start(s Session, sinceMS int64) error {
	if len(s.Cookies) == 0 {
		return errors.New("sessão sem cookies")
	}
	c := cookiesFrom(s.Cookies)
	if missing := c.GetMissingCookieNames(); len(missing) > 0 {
		return fmt.Errorf("sessão incompleta — faltam cookies %v", missing)
	}
	cli, err := m.newClient(c, s.Device, nil)
	if err != nil {
		return err
	}
	m.launch(cli, nil, nil, s.Device, sinceMS)
	return nil
}

// launch installs cli as the live client; viewer/mailbox are set when a login already loaded the index.
func (m *Manager) launch(cli *instameow.Client, viewer *types.PolarisViewer, mailbox *slidetypes.Mailbox, device *types.InstagramLoginDevice, sinceMS int64) {
	m.mu.Lock()
	m.stopLocked()
	m.gen++
	gen := m.gen
	ctx, cancel := context.WithCancel(context.Background())
	m.client = cli
	m.cancel = cancel
	m.device = device
	m.account = nil
	m.ownFBID = 0
	m.lastCookies = marshalCookies(cli)
	m.lastInboundMS = max(sinceMS, 0)
	m.groups = map[string]bool{}
	m.setStateLocked(stateConnecting, nil)
	m.mu.Unlock()

	cli.SetEventHandler(m.handler(gen))
	go m.run(ctx, gen, cli, viewer, mailbox)
	go m.cookieTicker(ctx, gen)
}

// stopLocked tears down the live client; Disconnect waits on the socket loop, so never inline.
func (m *Manager) stopLocked() {
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	if old := m.client; old != nil {
		go old.Disconnect()
		m.client = nil
	}
}

// Stop forgets the session (logout / shutdown); Core wipes its stored copy itself.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gen++
	m.stopLocked()
	m.account = nil
	m.ownFBID = 0
	m.setStateLocked(stateOff, nil)
}

func (m *Manager) Status() Status {
	m.mu.Lock()
	st := Status{State: m.state, Error: m.lastErr, Account: m.account}
	m.mu.Unlock()
	st.Login = m.pendingLoginStep()
	return st
}

func (m *Manager) setStateLocked(state string, e *errInfo) {
	if m.state == state && sameErr(m.lastErr, e) {
		return
	}
	m.state = state
	m.lastErr = e
	m.sink.emit(Event{Type: "state", State: state, Error: e, Account: m.account})
}

func sameErr(a, b *errInfo) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// setState applies only while gen is still the live client — a replaced client's late events are dropped.
func (m *Manager) setState(gen uint64, state string, e *errInfo) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen != m.gen {
		return false
	}
	m.setStateLocked(state, e)
	return true
}

func (m *Manager) current(gen uint64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return gen == m.gen
}

// fail parks the session in 'error': Instagram wants a human (re-login, checkpoint), so no auto-retry.
func (m *Manager) fail(gen uint64, e *errInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if gen != m.gen {
		return
	}
	m.log.Warn().Str("code", e.Code).Msg("session failed permanently")
	m.stopLocked()
	m.setStateLocked(stateError, e)
}

// classify maps request errors that need a human to a stable code; ok=false means retry.
func classify(err error) (*errInfo, bool) {
	switch {
	case errors.Is(err, httpclient.ErrTokenInvalidated):
		return &errInfo{"logged_out", "O Instagram encerrou a sessão — conecte de novo."}, true
	case errors.Is(err, httpclient.ErrChallengeRequired):
		return &errInfo{"challenge", "O Instagram pediu uma verificação — conclua no app ou no site e conecte de novo."}, true
	case errors.Is(err, httpclient.ErrCheckpointRequired):
		return &errInfo{"checkpoint", "O Instagram pediu uma verificação de segurança — conclua no app ou no site e conecte de novo."}, true
	case errors.Is(err, httpclient.ErrConsentRequired):
		return &errInfo{"consent", "O Instagram pede um consentimento — abra o app ou o site, aceite e conecte de novo."}, true
	case errors.Is(err, httpclient.ErrAccountSuspended):
		return &errInfo{"suspended", "O Instagram diz que a conta está suspensa."}, true
	}
	return nil, false
}

func (m *Manager) run(ctx context.Context, gen uint64, cli *instameow.Client, viewer *types.PolarisViewer, mailbox *slidetypes.Mailbox) {
	failures := 0
	for ctx.Err() == nil {
		if viewer == nil {
			var err error
			viewer, mailbox, err = cli.LoadIndex(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				if e, permanent := classify(err); permanent {
					m.fail(gen, e)
					return
				}
				failures++
				m.log.Warn().Err(err).Int("failures", failures).Msg("load index failed")
				m.setState(gen, stateConnecting, &errInfo{"connect_error", err.Error()})
				if !sleepCtx(ctx, backoff(failures)) {
					return
				}
				continue
			}
		}
		failures = 0
		m.onIndexLoaded(ctx, gen, cli, viewer, mailbox)
		viewer, mailbox = nil, nil
		// blocks until resnapshot, a handler-refused reconnect, or ctx cancel
		cli.Connect(ctx)
		if ctx.Err() != nil {
			return
		}
		if !sleepCtx(ctx, 5*time.Second) {
			return
		}
	}
}

func backoff(failures int) time.Duration {
	return min(time.Duration(1<<min(failures, 8))*time.Second, 5*time.Minute)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

func (m *Manager) onIndexLoaded(ctx context.Context, gen uint64, cli *instameow.Client, viewer *types.PolarisViewer, mailbox *slidetypes.Mailbox) {
	own := cli.GetOwnFBID()
	acct := &Account{Username: viewer.GetUsername(), Name: viewer.GetName(), IGID: viewer.ID}
	if own != 0 {
		acct.FBID = strconv.FormatInt(own, 10)
	}
	m.mu.Lock()
	if gen != m.gen {
		m.mu.Unlock()
		return
	}
	m.ownFBID = own
	m.account = acct
	m.mu.Unlock()
	m.log.Info().Str("username", acct.Username).Msg("index loaded")
	m.persistCookies(gen)
	m.catchUp(ctx, gen, cli, mailbox)
	// the first connect after a login skips catch-up (no floor); from here on this
	// process has a floor, so a resnapshot/reconnect replays what it missed
	m.mu.Lock()
	if gen == m.gen && m.lastInboundMS == 0 {
		m.lastInboundMS = time.Now().UnixMilli()
	}
	m.mu.Unlock()
}

func marshalCookies(cli *instameow.Client) string {
	b, _ := json.Marshal(cli.GetCookies().GetAll())
	return string(b)
}

// persistCookies pushes rotated cookies to Core so a restart resumes the fresh session.
func (m *Manager) persistCookies(gen uint64) {
	m.mu.Lock()
	if gen != m.gen || m.client == nil {
		m.mu.Unlock()
		return
	}
	cur := marshalCookies(m.client)
	if cur == m.lastCookies {
		m.mu.Unlock()
		return
	}
	m.lastCookies = cur
	s := &Session{Device: m.device}
	_ = json.Unmarshal([]byte(cur), &s.Cookies)
	m.mu.Unlock()
	m.sink.emit(Event{Type: "session", Session: s})
}

func (m *Manager) cookieTicker(ctx context.Context, gen uint64) {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.persistCookies(gen)
		}
	}
}

func (m *Manager) handler(gen uint64) instameow.EventHandler {
	return func(ctx context.Context, raw slidetypes.ClientEvent) error {
		if !m.current(gen) {
			// a replaced client must stop reconnecting
			if _, ok := raw.(*slidetypes.Disconnected); ok {
				return errors.New("client replaced")
			}
			return nil
		}
		switch evt := raw.(type) {
		case *slidetypes.Connected:
			m.setState(gen, stateOpen, nil)
		case *slidetypes.Disconnected:
			if websocket.CloseStatus(evt.Error) == dgw.CloseStatusUnauthorized {
				m.fail(gen, &errInfo{"unauthorized", "O Instagram encerrou a sessão — conecte de novo."})
				return errors.New("connection unauthorized")
			}
			m.setState(gen, stateConnecting, &errInfo{"disconnected", evt.Error.Error()})
			if evt.FailureCount > 5 && errors.Is(evt.Error, instameow.ErrMainStreamClosed) {
				// hand back to run(), which reloads the index before reconnecting
				return errors.New("main stream closed repeatedly")
			}
		case *slidetypes.AuthError:
			if e, permanent := classify(evt.Error); permanent {
				m.fail(gen, e)
			}
		case *slidetypes.Delta:
			if nm, ok := evt.Data.(*slidetypes.NewMessageEvent); ok && nm.Message != nil {
				m.mu.Lock()
				cli := m.client
				m.mu.Unlock()
				if cli != nil {
					m.forward(ctx, gen, cli, cmp.Or(evt.ThreadIGID, nm.Message.ThreadFBID), nm.Message)
				}
			}
		}
		return nil
	}
}

// forward relays a 1:1 text DM from someone else; own echoes, groups and media-only are skipped.
func (m *Manager) forward(ctx context.Context, gen uint64, cli *instameow.Client, threadID string, msg *slidetypes.Message) {
	m.mu.Lock()
	own := m.ownFBID
	m.mu.Unlock()
	if msg.SenderFBID == 0 || msg.SenderFBID == own {
		return
	}
	text := strings.TrimSpace(msg.TextBody)
	id := cmp.Or(msg.ID, msg.MessageID)
	if text == "" || id == "" {
		return
	}
	if m.isGroup(ctx, cli, threadID) {
		return
	}
	in := &InboundMessage{
		ID:       id,
		ThreadID: threadID,
		FromFBID: strconv.FormatInt(msg.SenderFBID, 10),
		Text:     text,
		SentAtMS: msg.TimestampMS.UnixMilli(),
	}
	if s := msg.Sender; s != nil {
		in.Username = s.UserDict.Username
		in.Name = cmp.Or(s.UserDict.FullName, s.Name)
		in.IGID = cmp.Or(s.IGID, s.UserDict.PK, s.UserDict.ID)
	}
	m.mu.Lock()
	if gen != m.gen {
		m.mu.Unlock()
		return
	}
	m.lastInboundMS = max(m.lastInboundMS, in.SentAtMS)
	m.mu.Unlock()
	m.sink.emit(Event{Type: "message", Message: in})
}

func (m *Manager) isGroup(ctx context.Context, cli *instameow.Client, threadID string) bool {
	if threadID == "" {
		return false
	}
	m.mu.Lock()
	g, ok := m.groups[threadID]
	m.mu.Unlock()
	if ok {
		return g
	}
	resp, err := cli.GetThread(ctx, slidetypes.MakeGetThreadInfoRequest(threadID))
	if err != nil || resp.ThreadInfo.AsIGDirectThread == nil {
		// unknown shape — deliver rather than silently drop a lead's message
		m.log.Warn().Err(err).Str("thread", threadID).Msg("thread lookup failed; treating as direct")
		return false
	}
	g = resp.ThreadInfo.AsIGDirectThread.IsGroup
	m.mu.Lock()
	m.groups[threadID] = g
	m.mu.Unlock()
	return g
}

const maxCatchUpThreads = 25

// catchUp replays DMs that arrived while no client was listening (restart, redeploy); Core dedupes by id.
func (m *Manager) catchUp(ctx context.Context, gen uint64, cli *instameow.Client, mailbox *slidetypes.Mailbox) {
	m.mu.Lock()
	since := m.lastInboundMS
	m.mu.Unlock()
	// first connect after login has no floor — importing the whole inbox as leads isn't wanted
	if since <= 0 || mailbox == nil {
		return
	}
	var threads []*slidetypes.ThreadInfo
	for _, e := range mailbox.ThreadsByFolder.Edges {
		if t := e.Node.AsIGDirectThread; t != nil {
			threads = append(threads, t)
		}
	}
	for _, w := range mailbox.PinnedThreadsV2 {
		if t := w.AsIGDirectThread; t != nil {
			threads = append(threads, t)
		}
	}
	var fresh []*slidetypes.ThreadInfo
	seen := map[string]bool{}
	for _, t := range threads {
		if t.IsGroup || seen[t.ThreadFBID] || t.LastActivityTimestampMS.UnixMilli() <= since {
			continue
		}
		seen[t.ThreadFBID] = true
		fresh = append(fresh, t)
	}
	slices.SortFunc(fresh, func(a, b *slidetypes.ThreadInfo) int {
		return a.LastActivityTimestampMS.Compare(b.LastActivityTimestampMS.Time)
	})
	if len(fresh) > maxCatchUpThreads {
		fresh = fresh[len(fresh)-maxCatchUpThreads:]
	}
	for _, t := range fresh {
		if ctx.Err() != nil || !m.current(gen) {
			return
		}
		resp, err := cli.GetThread(ctx, slidetypes.MakeGetThreadInfoRequest(t.ThreadFBID))
		if err != nil || resp.ThreadInfo.AsIGDirectThread == nil {
			m.log.Warn().Err(err).Str("thread", t.ThreadFBID).Msg("catch-up thread fetch failed")
			continue
		}
		full := resp.ThreadInfo.AsIGDirectThread
		m.mu.Lock()
		m.groups[t.ThreadFBID] = full.IsGroup
		m.mu.Unlock()
		if full.IsGroup || full.SlideMessages == nil {
			continue
		}
		var msgs []*slidetypes.Message
		for _, e := range full.SlideMessages.Edges {
			if e.Node != nil && e.Node.TimestampMS.UnixMilli() > since {
				msgs = append(msgs, e.Node)
			}
		}
		slices.SortFunc(msgs, func(a, b *slidetypes.Message) int {
			return a.TimestampMS.Compare(b.TimestampMS.Time)
		})
		for _, msg := range msgs {
			m.forward(ctx, gen, cli, t.ThreadFBID, msg)
		}
	}
}

func (m *Manager) liveClient() (*instameow.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil || m.state == stateError || m.state == stateOff {
		return nil, errNotConnected
	}
	return m.client, nil
}

type Resolved struct {
	FBID     string `json:"fbid"`
	IGID     string `json:"igid,omitempty"`
	Username string `json:"username"`
	Name     string `json:"name,omitempty"`
}

var usernameRe = regexp.MustCompile(`^[a-z0-9._]{1,30}$`)

// normalizeUsername accepts '@handle', 'handle' or an instagram.com profile URL.
func normalizeUsername(raw string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(raw))
	for _, p := range []string{"https://", "http://", "www.", "m.", "instagram.com/"} {
		u = strings.TrimPrefix(u, p)
	}
	u = strings.TrimPrefix(u, "@")
	if i := strings.IndexAny(u, "/?#"); i >= 0 {
		u = u[:i]
	}
	if !usernameRe.MatchString(u) {
		return "", errBadUsername
	}
	return u, nil
}

func (m *Manager) Resolve(ctx context.Context, raw string) (*Resolved, error) {
	u, err := normalizeUsername(raw)
	if err != nil {
		return nil, err
	}
	cli, err := m.liveClient()
	if err != nil {
		return nil, err
	}
	resp, err := cli.SearchUsers(ctx, u)
	if err != nil {
		return nil, fmt.Errorf("busca no instagram falhou: %w", err)
	}
	for _, r := range resp.Data.Results {
		if r != nil && strings.EqualFold(r.Username, u) && r.InteropMessagingUserFBID != 0 {
			return &Resolved{
				FBID:     strconv.FormatInt(r.InteropMessagingUserFBID, 10),
				IGID:     r.PK,
				Username: r.Username,
				Name:     r.FullName,
			}, nil
		}
	}
	return nil, errUserNotFound
}

type SendResult struct {
	MessageID string `json:"messageId"`
	ThreadID  string `json:"threadId,omitempty"`
	FBID      string `json:"fbid"`
}

// Send delivers one text DM, paced account-wide; cold DMs (no thread yet) go by recipient id.
func (m *Manager) Send(ctx context.Context, fbid, username, text string) (*SendResult, error) {
	cli, err := m.liveClient()
	if err != nil {
		return nil, err
	}
	if fbid == "" {
		r, err := m.Resolve(ctx, username)
		if err != nil {
			return nil, err
		}
		fbid = r.FBID
	}
	id, err := strconv.ParseInt(fbid, 10, 64)
	if err != nil || id <= 0 {
		return nil, errors.New("fbid inválido")
	}

	m.sendMu.Lock()
	defer m.sendMu.Unlock()
	if gap := m.cfg.MinSendGap; gap > 0 {
		wait := gap + rand.N(gap/2+1) - time.Since(m.lastSend)
		if wait > 0 && !sleepCtx(ctx, wait) {
			// Core gave up waiting — not sending keeps its 'failed' record true
			return nil, ctx.Err()
		}
	}
	defer func() { m.lastSend = time.Now() }()

	req := &slidetypes.SendTextRequest{
		OfflineThreadingID: strconv.FormatInt(methods.GenerateEpochID(), 10),
		Text:               slidetypes.SensitiveString{Value: text},
		SendAttribution:    ptr.Ptr("igd_web_chat_tab:in_thread"),
	}
	res := &SendResult{FBID: fbid}
	ids, err := cli.FetchThreadID(ctx, id)
	switch {
	case errors.Is(err, instameow.ErrThreadNotFound):
		req.RecipientIGIDs = []string{fbid}
	case err != nil:
		return nil, fmt.Errorf("thread lookup failed: %w", err)
	default:
		req.IGThreadIGID = &ids.ShortID
		res.ThreadID = ids.ShortID
	}
	resp, err := cli.SendMessage(ctx, req)
	if err != nil {
		return nil, err
	}
	res.MessageID = cmp.Or(resp.Message.ID, resp.Message.MessageID)
	if res.MessageID == "" {
		return nil, errors.New("instagram não devolveu id da mensagem")
	}
	return res, nil
}

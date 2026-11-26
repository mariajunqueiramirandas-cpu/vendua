package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

var (
	errActionBlocked = errors.New("o instagram bloqueou seguir contas por enquanto")
	errSelfFollow    = errors.New("essa é a própria conta conectada")
	errBlocking      = errors.New("a conta conectada bloqueou esse perfil")
	errBadFBID       = errors.New("fbid inválido")
)

var digitsRe = regexp.MustCompile(`^[0-9]{1,40}$`)

// pacer spaces one kind of account-wide action: gap plus up to 50% jitter since the last one.
type pacer struct {
	mu   sync.Mutex
	gap  time.Duration
	last time.Time
}

// do runs fn once the gap has passed; a ctx that ends first skips fn, so Core's record of
// "not done" stays true.
func (p *pacer) do(ctx context.Context, fn func() error) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.gap > 0 {
		wait := p.gap + rand.N(p.gap/2+1) - time.Since(p.last)
		if wait > 0 && !sleepCtx(ctx, wait) {
			return ctx.Err()
		}
	}
	defer func() { p.last = time.Now() }()
	return fn()
}

type FollowResult struct {
	FBID      string `json:"fbid"`
	IGID      string `json:"igid"`
	Username  string `json:"username,omitempty"`
	Following bool   `json:"following"`
	// a private account: the follow waits for their approval
	Requested bool `json:"requested"`
	// the connected account already followed them: nothing was sent
	Already bool `json:"already"`
}

// Follow makes the connected account follow someone unless it already does. The check is a
// read and isn't paced; the follow is, account-wide, apart from DMs.
func (m *Manager) Follow(ctx context.Context, fbid, username string) (*FollowResult, error) {
	cli, gen, own, err := m.liveSession()
	if err != nil {
		return nil, err
	}
	res := &FollowResult{FBID: fbid}
	if fbid == "" {
		res, err = resolveFollowUsername(ctx, cli, username)
		if err != nil {
			return nil, m.followError(gen, err)
		}
	}
	ownIGID := cli.GetCookies().Get(cookies.IGCookieDSUserID)
	if res.IGID != "" && res.IGID == ownIGID {
		return nil, errSelfFollow
	}
	if err := checkFollowTarget(ctx, cli, res, own); err != nil {
		return nil, m.followError(gen, err)
	}
	if res.IGID != "" && res.IGID == ownIGID {
		return nil, errSelfFollow
	}
	if res.Already {
		return res, nil
	}
	if !digitsRe.MatchString(res.IGID) {
		return nil, errProfileUnavailable
	}
	var fs *friendship
	err = m.followPace.do(ctx, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, activeGen, _, err := m.liveSession(); err != nil || activeGen != gen {
			return errNotConnected
		}
		var err error
		fs, err = createFriendship(ctx, cli, res.IGID, res.Username)
		return err
	})
	if err != nil {
		return nil, m.followError(gen, err)
	}
	res.Following, res.Requested = fs.Following, fs.OutgoingRequest
	if !res.Following && !res.Requested {
		return nil, errors.New("o instagram não confirmou o follow")
	}
	return res, nil
}

func resolveFollowUsername(ctx context.Context, cli *instameow.Client, raw string) (*FollowResult, error) {
	username, err := normalizeUsername(raw)
	if err != nil {
		return nil, err
	}
	signedCtx, cancel := context.WithTimeout(ctx, profileLookupTimeout)
	match, signedErr := searchProfileUsername(signedCtx, cli, username)
	cancel()
	if signedErr == nil {
		fbid := match.fbid()
		if digitsRe.MatchString(match.IGID) || fbid != "" {
			return &FollowResult{FBID: fbid, IGID: match.IGID, Username: match.Username}, nil
		}
		signedErr = errProfileUnavailable
	}
	p, err := publicProfileFallback(ctx, cli, username, signedErr)
	if err != nil {
		return nil, err
	}
	return &FollowResult{IGID: p.IGID, Username: p.Username}, nil
}

func checkFollowTarget(ctx context.Context, cli *instameow.Client, res *FollowResult, ownFBID int64) error {
	if res.FBID == "" {
		// The public page can supply an ID, but only the connected session can verify the target.
		user, err := profileUserByID(ctx, cli, res.Username, res.IGID)
		if err != nil {
			return err
		}
		status, _ := user["friendship_status"].(map[string]any)
		if blocking, _ := status["blocking"].(bool); blocking {
			return errBlocking
		}
		res.Following, _ = status["following"].(bool)
		res.Requested, _ = status["outgoing_request"].(bool)
		res.Already = res.Following || res.Requested
		return nil
	}

	id, err := strconv.ParseInt(res.FBID, 10, 64)
	if err != nil || id <= 0 {
		return errBadFBID
	}
	if id == ownFBID {
		return errSelfFollow
	}
	u, err := cli.GetUserForNewDM(ctx, id)
	if stopInstagramLookup(err) || errors.Is(err, types.ErrPleaseLogIn) {
		return err
	}
	if err != nil || u == nil || u.Data == nil {
		// An exact signed-in search already verified the Instagram ID for this messaging ID.
		if digitsRe.MatchString(res.IGID) {
			return nil
		}
		return errProfileUnavailable
	}
	if (digitsRe.MatchString(res.IGID) && u.Data.PK != "" && u.Data.PK != res.IGID) ||
		(res.Username != "" && u.Data.Username != "" && !strings.EqualFold(res.Username, u.Data.Username)) {
		return errProfileUnavailable
	}
	res.IGID = cmp.Or(u.Data.PK, res.IGID, u.Data.ID)
	res.Username = cmp.Or(u.Data.Username, res.Username)
	if b := u.Data.FriendshipStatus.Blocking; b != nil && *b {
		return errBlocking
	}
	res.Following = u.Data.FriendshipStatus.Following
	res.Already = res.Following
	return nil
}

func (m *Manager) followError(gen uint64, err error) error {
	if errors.Is(err, httpclient.ErrRateLimited) {
		return errProfileRateLimited
	}
	if errors.Is(err, types.ErrPleaseLogIn) {
		err = httpclient.ErrTokenInvalidated
	}
	if e, permanent := classify(err); permanent {
		m.fail(gen, e)
	}
	return err
}

type friendship struct {
	Following       bool `json:"following"`
	OutgoingRequest bool `json:"outgoing_request"`
}

// createFriendship is the web profile's Follow button; instameow has no follow call.
func createFriendship(ctx context.Context, cli *instameow.Client, igid, username string) (*friendship, error) {
	base := cli.GetEndpoint("base_url")
	referer := base + "/"
	if username != "" {
		referer += url.PathEscape(username) + "/"
	}
	h := cli.GetHTTP().BuildHeaders(true, false)
	h.Set("x-requested-with", "XMLHttpRequest")
	h.Set("origin", base)
	h.Set("referer", referer)
	h.Set("sec-fetch-dest", "empty")
	h.Set("sec-fetch-mode", "cors")
	h.Set("sec-fetch-site", "same-origin")
	form := url.Values{"container_module": {"profile"}, "user_id": {igid}}
	resp, body, err := cli.GetHTTP().MakeRequest(
		ctx, base+"/api/v1/friendships/create/"+igid+"/", http.MethodPost, h, []byte(form.Encode()), types.FORM,
	)
	if resp != nil {
		cli.GetCookies().UpdateFromResponse(resp)
	}
	return parseFriendship(body, err)
}

// parseFriendship reads the follow response; Instagram explains a refusal in the body, also on 4xx.
func parseFriendship(body []byte, reqErr error) (*friendship, error) {
	var r struct {
		Status     string     `json:"status"`
		Message    string     `json:"message"`
		Spam       bool       `json:"spam"`
		Friendship friendship `json:"friendship_status"`
	}
	parsed := len(body) > 0 && json.Unmarshal(body, &r) == nil
	// "feedback_required"/spam is Instagram's Action Blocked: retrying soon makes it longer
	if r.Spam || r.Message == "feedback_required" || errors.Is(reqErr, httpclient.ErrRateLimited) {
		return nil, errActionBlocked
	}
	if reqErr != nil {
		if r.Message != "" {
			return nil, fmt.Errorf("%w: %s", reqErr, r.Message)
		}
		return nil, reqErr
	}
	if !parsed || r.Status != "ok" {
		return nil, fmt.Errorf("follow recusado: %s", cmp.Or(r.Message, r.Status, "resposta inesperada"))
	}
	return &r.Friendship, nil
}

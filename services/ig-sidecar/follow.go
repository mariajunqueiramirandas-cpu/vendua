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
	"sync"
	"time"

	"go.mau.fi/mautrix-meta/pkg/instameow"
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
		r, err := m.Resolve(ctx, username)
		if err != nil {
			return nil, err
		}
		res.FBID, res.IGID, res.Username = r.FBID, r.IGID, r.Username
	}
	id, err := strconv.ParseInt(res.FBID, 10, 64)
	if err != nil || id <= 0 {
		return nil, errBadFBID
	}
	if id == own {
		return nil, errSelfFollow
	}
	// session-killing errors already reached the event handler through instameow
	u, lookupErr := cli.GetUserForNewDM(ctx, id)
	if lookupErr == nil && u != nil && u.Data != nil {
		res.IGID = cmp.Or(u.Data.PK, u.Data.ID, res.IGID)
		res.Username = cmp.Or(u.Data.Username, res.Username)
		if u.Data.FriendshipStatus.Following {
			res.Following, res.Already = true, true
			return res, nil
		}
		if u.Data.FriendshipStatus.Blocking {
			return nil, errBlocking
		}
	}
	if !digitsRe.MatchString(res.IGID) {
		if lookupErr != nil {
			return nil, fmt.Errorf("perfil do instagram não carregou: %w", lookupErr)
		}
		return nil, errUserNotFound
	}
	// a failed lookup with a known id still follows: Instagram's follow is idempotent
	var fs *friendship
	err = m.followPace.do(ctx, func() error {
		var err error
		fs, err = createFriendship(ctx, cli, res.IGID, res.Username)
		return err
	})
	if err != nil {
		if e, permanent := classify(err); permanent {
			m.fail(gen, e)
		}
		return nil, err
	}
	res.Following, res.Requested = fs.Following, fs.OutgoingRequest
	if !res.Following && !res.Requested {
		return nil, errors.New("o instagram não confirmou o follow")
	}
	return res, nil
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

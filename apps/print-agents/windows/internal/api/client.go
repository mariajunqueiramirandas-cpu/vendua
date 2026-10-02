// Package api is the agent side of Core's /admin/v1/agent endpoints.
package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"time"
)

// Platform is what Core knows this agent as; the Linux build is for development.
var Platform = func() string {
	if runtime.GOOS == "linux" {
		return "linux"
	}
	return "windows"
}()

// Printer is a printer as Core configures it for this device.
type Printer struct {
	ID      string `json:"id"`
	Key     string `json:"key"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Address string `json:"address"`
}

// Discovered is a printer this agent found locally, reported by PUT /printers.
type Discovered struct {
	Key     string `json:"key"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Address string `json:"address"`
}

type PairResponse struct {
	DeviceCode string `json:"deviceCode"`
	UserCode   string `json:"userCode"`
	ApproveURL string `json:"approveUrl"`
	ExpiresIn  int    `json:"expiresIn"`
	Interval   int    `json:"interval"`
}

type PollResponse struct {
	Status string `json:"status"`
	Token  string `json:"token"`
	Store  struct {
		Name string `json:"name"`
	} `json:"store"`
}

// Error is a non-2xx answer from Core.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	if e.Code == "" {
		return fmt.Sprintf("core: HTTP %d", e.Status)
	}
	return fmt.Sprintf("core: HTTP %d %s: %s", e.Status, e.Code, e.Message)
}

// IsUnauthorized reports whether err means the stored token is no longer valid.
func IsUnauthorized(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == http.StatusUnauthorized
}

// HasStatus reports whether err is a Core error with the given HTTP status.
func HasStatus(err error, status int) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == status
}

// Client is safe for concurrent use. It holds no token: callers pass the one
// they read, so a 401 can be pinned to the exact token that caused it.
type Client struct {
	base    string
	version string
	http    *http.Client
	stream  *http.Client
}

func NewClient(base, version string) *Client {
	// The stream has no overall timeout: once headers arrive, liveness is
	// the caller's idle timeout.
	st := http.DefaultTransport.(*http.Transport).Clone()
	st.ResponseHeaderTimeout = 30 * time.Second
	return &Client{
		base:    strings.TrimRight(base, "/"),
		version: version,
		http:    &http.Client{Timeout: 30 * time.Second},
		stream:  &http.Client{Transport: st},
	}
}

func (c *Client) Base() string { return c.base }

func (c *Client) Pair(ctx context.Context, name string) (*PairResponse, error) {
	body := map[string]string{"platform": Platform, "name": name, "version": c.version}
	var out PairResponse
	if err := c.do(ctx, http.MethodPost, "/admin/v1/agent/pair", "", "", body, &out); err != nil {
		return nil, err
	}
	if out.DeviceCode == "" || out.UserCode == "" {
		return nil, errors.New("core: pair response without codes")
	}
	return &out, nil
}

func (c *Client) PollPair(ctx context.Context, deviceCode string) (*PollResponse, error) {
	var out PollResponse
	if err := c.do(ctx, http.MethodPost, "/admin/v1/agent/pair/poll", "", "", map[string]string{"deviceCode": deviceCode}, &out); err != nil {
		return nil, err
	}
	if out.Status == "approved" && out.Token == "" {
		return nil, errors.New("core: approved without a token")
	}
	return &out, nil
}

func (c *Client) ReportResult(ctx context.Context, token, jobID string, ok bool, errMsg string) error {
	body := map[string]any{"ok": ok}
	if !ok {
		body["error"] = errMsg
	}
	path := "/admin/v1/agent/jobs/" + url.PathEscape(jobID) + "/result"
	return c.do(ctx, http.MethodPost, path, token, "job-result-"+jobID, body, nil)
}

// PutPrinters reports the full discovered set; key must be reused on retries.
func (c *Client) PutPrinters(ctx context.Context, token, key string, found []Discovered) ([]Printer, error) {
	if found == nil {
		found = []Discovered{}
	}
	var out struct {
		Printers []Printer `json:"printers"`
	}
	if err := c.do(ctx, http.MethodPut, "/admin/v1/agent/printers", token, key, map[string]any{"printers": found}, &out); err != nil {
		return nil, err
	}
	return out.Printers, nil
}

func (c *Client) TestPrinter(ctx context.Context, token, printerID string) (string, error) {
	var out struct {
		JobID string `json:"jobId"`
	}
	path := "/admin/v1/agent/printers/" + url.PathEscape(printerID) + "/test"
	if err := c.do(ctx, http.MethodPost, path, token, NewUUID(), nil, &out); err != nil {
		return "", err
	}
	return out.JobID, nil
}

func (c *Client) DeleteSelf(ctx context.Context, token string) error {
	return c.do(ctx, http.MethodDelete, "/admin/v1/agent/self", token, NewUUID(), nil, nil)
}

// OpenStream starts the SSE stream. The caller owns the returned body.
func (c *Client) OpenStream(ctx context.Context, token string) (io.ReadCloser, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/admin/v1/agent/stream", token, "", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := c.stream.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, decodeError(resp)
	}
	return resp.Body, nil
}

func (c *Client) newRequest(ctx context.Context, method, path, token, idemKey string, body any) (*http.Request, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", fmt.Sprintf("VenduaImpressora/%s (%s)", c.version, Platform))
	req.Header.Set("X-Agent-Platform", Platform)
	req.Header.Set("X-Agent-Version", c.version)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	return req, nil
}

func (c *Client) do(ctx context.Context, method, path, token, idemKey string, body, out any) error {
	req, err := c.newRequest(ctx, method, path, token, idemKey, body)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return decodeError(resp)
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out); err != nil {
		return fmt.Errorf("core: decode %s %s: %w", method, path, err)
	}
	return nil
}

func decodeError(resp *http.Response) error {
	e := &Error{Status: resp.StatusCode}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body) == nil {
		e.Code = body.Error.Code
		e.Message = body.Error.Message
	}
	return e
}

// NewUUID returns a random RFC 4122 version 4 UUID.
func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

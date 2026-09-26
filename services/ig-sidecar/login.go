// Login flow adapted from mautrix-meta pkg/igconnector/login_native.go
// (AGPL-3.0, Copyright (C) 2026 Killian Lelong) — same instameow calls and
// safety checks, minus the Matrix bridge: steps come out as plain JSON.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"maunium.net/go/mautrix/bridgev2"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/loginerrors"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

// Step is one screen of the login wizard as Core/CRM render it.
type Step struct {
	// input = show fields and submit; wait = approve elsewhere, then submit {}; complete = done
	Type         string   `json:"type"`
	StepID       string   `json:"stepId"`
	Instructions string   `json:"instructions"`
	Fields       []Field  `json:"fields,omitempty"`
	Account      *Account `json:"account,omitempty"`
	Session      *Session `json:"session,omitempty"`
}

type Field struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Type    string   `json:"type"` // username | password | 2fa_code | select | text
	Options []string `json:"options,omitempty"`
}

// LoginError carries a stable code the CRM can branch on.
type LoginError struct {
	Status  int
	Code    string
	Message string
}

func (e *LoginError) Error() string { return e.Message }

const (
	stepCredentials   = "instagram.credentials"
	stepTwoFactor     = "instagram.two_factor"
	stepCookieConsent = "instagram.cookie_consent"

	fieldIdentifier = "username"
	fieldPassword   = "password"
	fieldTwoFactor  = "verification_code"

	declineOptionalCookies = "Continuar só com os cookies obrigatórios"
	cancelCookieConsent    = "Cancelar login"

	loginTTL = 15 * time.Minute
)

var (
	errUnsupportedStep = &LoginError{http.StatusBadRequest, "unsupported_step",
		"O Instagram pediu uma etapa de login que não dá para concluir por aqui. Entre pelo navegador e use a opção de cookies."}
	errCAAFailed = &LoginError{http.StatusBadGateway, "login_step_failed",
		"O Instagram não concluiu essa etapa. Tente de novo."}
	errCheckpointUnsupported = &LoginError{http.StatusBadRequest, "checkpoint_unsupported",
		"O Instagram pediu uma verificação que não dá para concluir por aqui. Conclua no app, depois comece o login de novo — ou use a opção de cookies."}
	errCaptcha = &LoginError{http.StatusBadRequest, "captcha",
		"O Instagram pediu um CAPTCHA. Entre pelo navegador e use a opção de cookies."}
	errRateLimited = &LoginError{http.StatusTooManyRequests, "rate_limited",
		"O Instagram está limitando tentativas de login. Espere alguns minutos."}
	errSuspended = &LoginError{http.StatusForbidden, "suspended",
		"O Instagram diz que a conta está suspensa."}
	errNoLogin = &LoginError{http.StatusConflict, "no_login",
		"Nenhum login em andamento — comece de novo."}
	errLoginCancelled = &LoginError{http.StatusConflict, "cancelled", "Login cancelado."}
)

// CAA (mobile fallback) steps we can render safely: one field, known id/type.
var caaSafeSteps = map[string][3]string{
	"fi.mau.meta.instagram.caa.password":    {"password", "Senha", "Digite a senha do Instagram de novo."},
	"fi.mau.meta.instagram.caa.otp_code":    {"otp_code", "Código", "Digite o código de verificação do Instagram."},
	"fi.mau.meta.instagram.caa.backup_code": {"backup_code", "Código de backup", "Digite um dos códigos de backup do Instagram."},
	"fi.mau.meta.instagram.caa.totp":        {"totp_code", "Código de 6 dígitos", "Digite o código do app autenticador."},
	"fi.mau.meta.instagram.caa.sms":         {"sms_code", "Código de 6 dígitos", "Digite o código que o Instagram mandou por SMS."},
	"fi.mau.meta.instagram.caa.whatsapp":    {"whatsapp_code", "Código de 6 dígitos", "Digite o código que o Instagram mandou no WhatsApp."},
}

type pendingConsent struct {
	identifier, password string
	allowCAAFallback     bool
}

type loginProc struct {
	m       *Manager
	client  *instameow.Client
	device  *types.InstagramLoginDevice
	started time.Time

	caaIdentifier, caaPassword, caaUserID string
	webTwoFactor                          *instameow.InstagramWebTwoFactorChallenge
	webSessionReady                       bool
	webCookieConsent                      *pendingConsent
}

func credentialsStep(instructions string) *Step {
	return &Step{
		Type: "input", StepID: stepCredentials, Instructions: instructions,
		Fields: []Field{
			{ID: fieldIdentifier, Name: "E-mail ou usuário", Type: "username"},
			{ID: fieldPassword, Name: "Senha", Type: "password"},
		},
	}
}

func cookieConsentStep() *Step {
	return &Step{
		Type: "input", StepID: stepCookieConsent,
		Instructions: "O Instagram pede um aceite de cookies. Os opcionais serão recusados.",
		Fields: []Field{{ID: "cookie_consent", Name: "Cookies do Instagram", Type: "select",
			Options: []string{declineOptionalCookies, cancelCookieConsent}}},
	}
}

func twoFactorStep(ch *instameow.InstagramWebTwoFactorChallenge, instructions string) *Step {
	if instructions == "" {
		switch {
		case ch != nil && ch.TOTP:
			instructions = "Digite o código do app autenticador."
		case ch != nil && ch.Email:
			instructions = "Digite o código que o Instagram mandou por e-mail."
		case ch != nil && (ch.SMS || ch.WhatsApp):
			instructions = "Digite o código que o Instagram mandou para você."
		default:
			instructions = "Digite o código de verificação do Instagram."
		}
	}
	return &Step{
		Type: "input", StepID: stepTwoFactor, Instructions: instructions,
		Fields: []Field{{ID: fieldTwoFactor, Name: "Código de verificação", Type: "2fa_code"}},
	}
}

// fromBridgeStep converts an instameow/bridgev2 step; webview/cookie/webauthn handoffs can't be rendered.
func fromBridgeStep(s *bridgev2.LoginStep) (*Step, error) {
	switch s.Type {
	case bridgev2.LoginStepTypeUserInput:
		if s.UserInputParams == nil {
			return nil, errUnsupportedStep
		}
		out := &Step{Type: "input", StepID: s.StepID, Instructions: s.Instructions}
		for _, f := range s.UserInputParams.Fields {
			out.Fields = append(out.Fields, Field{ID: f.ID, Name: f.Name, Type: string(f.Type), Options: f.Options})
		}
		return out, nil
	case bridgev2.LoginStepTypeDisplayAndWait:
		if s.DisplayAndWaitParams == nil || s.DisplayAndWaitParams.Type != bridgev2.LoginDisplayTypeNothing {
			return nil, errUnsupportedStep
		}
		return &Step{Type: "wait", StepID: s.StepID, Instructions: s.Instructions}, nil
	case bridgev2.LoginStepTypeCookies:
		// the web auth platform's CAPTCHA handoff needs an embedded browser
		return nil, errCaptcha
	}
	return nil, errUnsupportedStep
}

func sanitizeCAAStep(step *bridgev2.LoginStep) error {
	if step == nil {
		return nil
	}
	if step.CookiesParams != nil || step.ClientHTTPParams != nil || step.WebAuthnParams != nil || step.CompleteParams != nil {
		return errUnsupportedStep
	}
	if step.Type == bridgev2.LoginStepTypeDisplayAndWait {
		if step.StepID != "fi.mau.meta.instagram.caa.afad_wait" || step.UserInputParams != nil ||
			step.DisplayAndWaitParams == nil || step.DisplayAndWaitParams.Type != bridgev2.LoginDisplayTypeNothing ||
			step.DisplayAndWaitParams.Data != "" || step.DisplayAndWaitParams.ImageURL != "" {
			return errUnsupportedStep
		}
		step.Instructions = "Aprove este login pela notificação do Instagram e depois continue."
		return nil
	}
	spec, ok := caaSafeSteps[step.StepID]
	if !ok || step.Type != bridgev2.LoginStepTypeUserInput || step.DisplayAndWaitParams != nil ||
		step.UserInputParams == nil || len(step.UserInputParams.Attachments) != 0 || len(step.UserInputParams.Fields) != 1 {
		return errUnsupportedStep
	}
	field := &step.UserInputParams.Fields[0]
	expected := bridgev2.LoginInputFieldType2FACode
	if spec[0] == "password" {
		expected = bridgev2.LoginInputFieldTypePassword
	}
	if field.ID != spec[0] || field.Type != expected || field.DefaultValue != "" || len(field.Options) != 0 {
		return errUnsupportedStep
	}
	field.Name, step.Instructions, field.Description, field.Pattern = spec[1], spec[2], "", ""
	return nil
}

func (m *Manager) pendingLoginStep() *Step {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.loginView == nil || time.Since(m.loginAt) > loginTTL {
		return nil
	}
	return m.loginView
}

// setLogin swaps the live wizard; callers hold loginMu.
func (m *Manager) setLogin(p *loginProc) {
	m.login = p
	m.mu.Lock()
	m.loginView = nil
	if p != nil {
		m.loginAt = p.started
	}
	m.mu.Unlock()
}

// LoginStart begins a password login; device is the stored Android identity, if any.
func (m *Manager) LoginStart(device *types.InstagramLoginDevice) (*Step, error) {
	m.loginMu.Lock()
	defer m.loginMu.Unlock()
	p := &loginProc{m: m, device: device, started: time.Now()}
	c := &cookies.Cookies{Platform: types.Instagram}
	c.UpdateValues(nil)
	cli, err := m.newClient(c, device, func(d types.InstagramLoginDevice) { p.device = &d })
	if err != nil {
		return nil, err
	}
	p.client = cli
	m.setLogin(p)
	return p.remember(credentialsStep("Entre com o e-mail ou usuário e a senha da conta do Instagram."), nil)
}

func (m *Manager) LoginCancel() {
	m.loginMu.Lock()
	defer m.loginMu.Unlock()
	if m.login != nil && m.login.client != nil {
		m.login.client.ClearInstagramCAALoginState()
	}
	m.setLogin(nil)
}

// LoginSubmit feeds one step's input; an empty map answers a 'wait' step.
func (m *Manager) LoginSubmit(ctx context.Context, input map[string]string) (*Step, error) {
	m.loginMu.Lock()
	defer m.loginMu.Unlock()
	p := m.login
	if p == nil || time.Since(p.started) > loginTTL {
		m.setLogin(nil)
		return nil, errNoLogin
	}
	step, err := p.submit(ctx, input)
	if err != nil || (step != nil && step.Type == "complete") {
		// terminal either way — the next attempt starts clean
		m.setLogin(nil)
	}
	return step, err
}

func (p *loginProc) remember(s *Step, err error) (*Step, error) {
	if err == nil && s != nil && s.Type != "complete" {
		p.m.mu.Lock()
		if p.m.login == p {
			p.m.loginView = s
		}
		p.m.mu.Unlock()
	}
	return s, err
}

func (p *loginProc) clearCAA() {
	p.client.ClearInstagramCAALoginState()
	p.caaIdentifier, p.caaPassword, p.caaUserID = "", "", ""
}

func (p *loginProc) restart(instructions string) (*Step, error) {
	p.clearCAA()
	p.webTwoFactor, p.webSessionReady, p.webCookieConsent = nil, false, nil
	c := &cookies.Cookies{Platform: types.Instagram}
	c.UpdateValues(nil)
	cli, err := p.m.newClient(c, p.device, func(d types.InstagramLoginDevice) { p.device = &d })
	if err != nil {
		return nil, err
	}
	p.client = cli
	return p.remember(credentialsStep(instructions), nil)
}

func isClientHTTPError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "error from client: ")
}

func (p *loginProc) submit(ctx context.Context, input map[string]string) (*Step, error) {
	if p.caaIdentifier != "" {
		return p.continueCAA(ctx, input)
	}
	if p.webCookieConsent != nil {
		switch input["cookie_consent"] {
		case declineOptionalCookies:
			pending := p.webCookieConsent
			return p.submitCredentials(ctx, pending.identifier, pending.password, pending.allowCAAFallback)
		case cancelCookieConsent:
			return nil, errLoginCancelled
		default:
			return p.remember(cookieConsentStep(), nil)
		}
	}
	if p.webSessionReady {
		return p.continueAccountManager(ctx, input)
	}
	if p.webTwoFactor != nil && p.webTwoFactor.AuthPlatform {
		step, err := p.client.DoInstagramWebAuthPlatformSteps(ctx, input)
		return p.handleAuthPlatform(ctx, step, err)
	}
	if p.webTwoFactor != nil {
		code := strings.TrimSpace(input[fieldTwoFactor])
		if code == "" {
			return p.remember(twoFactorStep(p.webTwoFactor, "Digite o código para continuar."), nil)
		}
		err := p.client.CompleteInstagramWebSessionTwoFactor(ctx, code)
		switch {
		case err == nil:
		case isClientHTTPError(err) || errors.Is(err, instameow.ErrInstagramWebCheckpointRequestFailed):
			return p.remember(twoFactorStep(p.webTwoFactor, "A requisição não completou. Digite um código novo e tente de novo."), nil)
		case errors.Is(err, instameow.ErrInstagramWebCheckpointUnsupported):
			return nil, errCheckpointUnsupported
		case errors.Is(err, instameow.ErrInstagramWebTwoFactorCodeResent):
			return p.remember(twoFactorStep(p.webTwoFactor, "O Instagram recusou o código e mandou um SMS novo. Digite o código novo."), nil)
		case errors.Is(err, instameow.ErrInstagramWebTwoFactorCodeRejected):
			return p.remember(twoFactorStep(p.webTwoFactor, "O Instagram não aceitou o código. Confira se é o mais recente e tente de novo."), nil)
		case errors.Is(err, httpclient.ErrRateLimited):
			return nil, errRateLimited
		case errors.Is(err, httpclient.ErrAccountSuspended):
			return nil, errSuspended
		default:
			return nil, fmt.Errorf("falha na verificação em duas etapas: %w", err)
		}
		p.webTwoFactor, p.webSessionReady = nil, true
		return p.continueAccountManager(ctx, input)
	}
	identifier := strings.TrimSpace(input[fieldIdentifier])
	password := input[fieldPassword]
	if identifier == "" || password == "" {
		return p.remember(credentialsStep("Preencha o e-mail ou usuário e a senha."), nil)
	}
	return p.submitCredentials(ctx, identifier, password, true)
}

func (p *loginProc) submitCredentials(ctx context.Context, identifier, password string, allowCAAFallback bool) (*Step, error) {
	var challenge *instameow.InstagramWebTwoFactorChallenge
	var err error
	if p.webCookieConsent != nil {
		p.webCookieConsent = nil
		challenge, err = p.client.ContinueInstagramWebSessionAfterCookieConsent(ctx, identifier, password)
	} else {
		challenge, err = p.client.CreateInstagramWebSession(ctx, identifier, password)
	}
	if err != nil {
		switch {
		case errors.Is(err, instameow.ErrInstagramWebCookieConsentRequired):
			p.webCookieConsent = &pendingConsent{identifier, password, allowCAAFallback}
			return p.remember(cookieConsentStep(), nil)
		case isClientHTTPError(err) || errors.Is(err, instameow.ErrInstagramWebCheckpointRequestFailed):
			return p.restart("A requisição não completou. Tente de novo.")
		case errors.Is(err, instameow.ErrInstagramWebCheckpointUnsupported):
			return nil, errCheckpointUnsupported
		case errors.Is(err, instameow.ErrInstagramWebCheckpointCAPTCHA):
			return nil, errCaptcha
		case errors.Is(err, instameow.ErrInstagramWebLoginRejected):
			return p.remember(credentialsStep("O Instagram não deixou entrar. Confira a conta no app antes de tentar de novo."), nil)
		case errors.Is(err, instameow.ErrInstagramWebCredentialsRejected):
			return p.remember(credentialsStep("Usuário ou senha incorretos. Confira e tente de novo."), nil)
		case errors.Is(err, httpclient.ErrRateLimited):
			return nil, errRateLimited
		case errors.Is(err, httpclient.ErrAccountSuspended):
			return nil, errSuspended
		case errors.Is(err, httpclient.ErrChallengeRequired) || errors.Is(err, httpclient.ErrCheckpointRequired):
			if !allowCAAFallback {
				return nil, errCAAFailed
			}
			p.caaIdentifier, p.caaPassword = identifier, password
			p.caaUserID = p.client.GetCookies().Get(cookies.IGCookieDSUserID)
			return p.continueCAA(ctx, map[string]string{fieldIdentifier: identifier, fieldPassword: password})
		case strings.Contains(err.Error(), "instagram web two-factor challenge is missing a CSRF token"):
			return p.restart("O Instagram não devolveu o estado de segurança. Tente de novo.")
		}
		return nil, fmt.Errorf("falha ao criar sessão no Instagram: %w", err)
	}
	if challenge != nil {
		p.webTwoFactor = challenge
		if challenge.AuthPlatform {
			step, err := p.client.DoInstagramWebAuthPlatformSteps(ctx, nil)
			return p.handleAuthPlatform(ctx, step, err)
		}
		return p.remember(twoFactorStep(challenge, ""), nil)
	}
	p.webSessionReady = true
	return p.continueAccountManager(ctx, map[string]string{})
}

func (p *loginProc) handleAuthPlatform(ctx context.Context, step *bridgev2.LoginStep, err error) (*Step, error) {
	switch {
	case errors.Is(err, instameow.ErrInstagramWebLoginRejected):
		p.webTwoFactor = nil
		return p.remember(credentialsStep("O Instagram não deixou entrar. Confira a conta no app antes de tentar de novo."), nil)
	case errors.Is(err, instameow.ErrInstagramWebCheckpointCAPTCHA):
		return nil, errCaptcha
	case errors.Is(err, httpclient.ErrRateLimited):
		return nil, errRateLimited
	case errors.Is(err, httpclient.ErrAccountSuspended):
		return nil, errSuspended
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		return nil, err
	case errors.Is(err, instameow.ErrInstagramWebCheckpointRequestFailed):
		return nil, errCAAFailed
	case err != nil:
		return nil, errCheckpointUnsupported
	case step != nil:
		s, err := fromBridgeStep(step)
		return p.remember(s, err)
	}
	p.webTwoFactor, p.webSessionReady = nil, true
	return p.continueAccountManager(ctx, nil)
}

func (p *loginProc) continueCAA(ctx context.Context, input map[string]string) (*Step, error) {
	if pw := input[fieldPassword]; pw != "" {
		p.caaPassword = pw
	}
	step, err := p.client.DoInstagramCAALoginStepsExactAccount(ctx, input, p.caaIdentifier, p.caaUserID)
	if err != nil {
		p.clearCAA()
		var re bridgev2.RespError
		switch {
		case isClientHTTPError(err):
			return p.restart("A requisição não completou. Tente de novo.")
		case errors.Is(err, instameow.ErrInstagramCAAUnsafeAccountStep):
			return nil, errUnsupportedStep
		case errors.As(err, &re):
			return nil, fromRespError(re)
		case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
			return nil, err
		}
		return nil, errCAAFailed
	}
	if err = sanitizeCAAStep(step); err != nil {
		p.clearCAA()
		return nil, err
	}
	if step != nil {
		s, err := fromBridgeStep(step)
		return p.remember(s, err)
	}
	identifier, password := p.caaIdentifier, p.caaPassword
	p.clearCAA()
	return p.submitCredentials(ctx, identifier, password, false)
}

func (p *loginProc) continueAccountManager(ctx context.Context, input map[string]string) (*Step, error) {
	step, err := p.client.DoInstagramWebAccountManagerSteps(ctx, input)
	switch {
	case errors.Is(err, httpclient.ErrConsentRequired):
		return nil, fromRespError(loginerrors.Consent)
	case errors.Is(err, httpclient.ErrRateLimited):
		return nil, errRateLimited
	case errors.Is(err, httpclient.ErrAccountSuspended):
		return nil, errSuspended
	case err != nil:
		return nil, fmt.Errorf("falha ao escolher o perfil no Instagram: %w", err)
	case step != nil:
		s, err := fromBridgeStep(step)
		return p.remember(s, err)
	}
	return p.m.completeLogin(ctx, p.client.GetCookies(), p.device)
}

func fromRespError(re bridgev2.RespError) *LoginError {
	status := re.StatusCode
	if status == 0 {
		status = http.StatusBadRequest
	}
	return &LoginError{Status: status, Code: strings.ToLower(strings.TrimPrefix(re.ErrCode, "FI.MAU.META_")), Message: re.Err}
}

// completeLogin validates fresh cookies with a real index load, then hands that client to the manager.
func (m *Manager) completeLogin(ctx context.Context, c *cookies.Cookies, device *types.InstagramLoginDevice) (*Step, error) {
	if missing := c.GetMissingCookieNames(); len(missing) > 0 {
		return nil, &LoginError{http.StatusBadRequest, "missing_cookies",
			fmt.Sprintf("Faltam cookies obrigatórios: %v", missing)}
	}
	values := map[string]string{}
	for k, v := range c.GetAll() {
		values[string(k)] = v
	}
	cli, err := m.newClient(cookiesFrom(values), device, nil)
	if err != nil {
		return nil, err
	}
	viewer, mailbox, err := cli.LoadIndex(ctx)
	if err != nil {
		switch {
		case errors.Is(err, httpclient.ErrRateLimited):
			return nil, errRateLimited
		case errors.Is(err, httpclient.ErrChallengeRequired):
			return nil, fromRespError(loginerrors.Challenge)
		case errors.Is(err, httpclient.ErrCheckpointRequired):
			return nil, fromRespError(loginerrors.Checkpoint)
		case errors.Is(err, httpclient.ErrConsentRequired):
			return nil, fromRespError(loginerrors.Consent)
		case errors.Is(err, httpclient.ErrAccountSuspended):
			return nil, errSuspended
		case errors.Is(err, httpclient.ErrTokenInvalidated):
			return nil, &LoginError{http.StatusBadRequest, "token_invalidated",
				"O Instagram encerrou a sessão logo após o login. Entre de novo."}
		}
		return nil, fmt.Errorf("falha ao carregar a conta: %w", err)
	}
	if cli.GetOwnFBID() == 0 {
		return nil, errors.New("o Instagram não devolveu o id da conta")
	}
	// the first connect has no catch-up floor: an existing inbox isn't imported as leads
	m.launch(cli, viewer, mailbox, device, 0)
	return &Step{
		Type:         "complete",
		StepID:       "instagram.complete",
		Instructions: fmt.Sprintf("Conectado como @%s.", viewer.GetUsername()),
		Account:      &Account{Username: viewer.GetUsername(), Name: viewer.GetName(), IGID: viewer.ID},
		Session:      &Session{Cookies: values, Device: device},
	}, nil
}

// LoginCookies is the fallback: staff logs in on a real browser and pastes cookies or a cURL command.
func (m *Manager) LoginCookies(ctx context.Context, raw string, device *types.InstagramLoginDevice) (*Step, error) {
	values, err := parseCookieInput(raw)
	if err != nil {
		return nil, &LoginError{http.StatusBadRequest, "bad_cookies", err.Error()}
	}
	m.loginMu.Lock()
	defer m.loginMu.Unlock()
	m.setLogin(nil)
	return m.completeLogin(ctx, cookiesFrom(values), device)
}

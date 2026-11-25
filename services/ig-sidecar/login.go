// Login flow adapted from mautrix-meta pkg/igconnector/login_native.go
// (AGPL-3.0, Copyright (C) 2026 Killian Lelong) — same instameow calls and
// safety checks, minus the Matrix bridge: steps come out as plain JSON.
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/event"

	"go.mau.fi/mautrix-meta/pkg/instameow"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/httpclient"
	"go.mau.fi/mautrix-meta/pkg/messagix/loginerrors"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
)

// Step is one screen of the login wizard as Core/CRM render it.
type Step struct {
	// input and wait use the form, captcha uses the provider widget, complete ends the wizard.
	Type         string   `json:"type"`
	StepID       string   `json:"stepId"`
	Instructions string   `json:"instructions"`
	Fields       []Field  `json:"fields,omitempty"`
	Captcha      *Captcha `json:"captcha,omitempty"`
	// Image is the Android login's letters captcha, a data: URL shown above its field.
	Image string `json:"image,omitempty"`
	// Code is the number to tap on the other device; Back offers "use another method" on a wait step.
	Code    string   `json:"code,omitempty"`
	Back    bool     `json:"back,omitempty"`
	Account *Account `json:"account,omitempty"`
	Session *Session `json:"session,omitempty"`
}

type Captcha struct {
	IframeURL string `json:"iframeURL"`
	Instance  string `json:"instance"`
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
	stepApprove       = "fi.mau.meta.instagram.auth_platform.approve"

	fieldIdentifier = "username"
	fieldPassword   = "password"
	fieldTwoFactor  = "verification_code"
	fieldCaptcha    = "captcha_token"
	fieldCaptchaID  = "captcha_instance"

	declineOptionalCookies = "Continuar só com os cookies obrigatórios"
	cancelCookieConsent    = "Cancelar login"

	caaPrefix = "fi.mau.meta.instagram.caa."

	loginTTL = 15 * time.Minute
	// instameow polls an approval until its context ends; one "já aprovei" stays under Core's 30s
	// call timeout, and running out hands the same step back (the approval state survives)
	approvalPoll = 20 * time.Second
)

var approvalCodeRe = regexp.MustCompile(`^[0-9A-Za-z]{1,12}$`)

// letters-captcha images Instagram serves are a few KB; raster types only, never SVG
const maxCaptchaImage = 128 << 10

var captchaImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

var (
	errUnsupportedStep = &LoginError{http.StatusBadRequest, "unsupported_step",
		"Abra o Instagram para verificar a conta. Depois, inicie um novo login aqui."}
	errCAAFailed = &LoginError{http.StatusBadGateway, "login_step_failed",
		"O Instagram não concluiu essa etapa. Tente de novo."}
	errCheckpointUnsupported = &LoginError{http.StatusBadRequest, "checkpoint_unsupported",
		"Conclua a verificação no Instagram. Depois, inicie um novo login aqui."}
	errCaptcha = &LoginError{http.StatusBadRequest, "captcha",
		"O Instagram pediu uma verificação. Abra o Instagram para verificar a conta e tente entrar aqui de novo."}
	errRateLimited = &LoginError{http.StatusTooManyRequests, "rate_limited",
		"O Instagram está limitando tentativas de login. Espere alguns minutos."}
	errSuspended = &LoginError{http.StatusForbidden, "suspended",
		"O Instagram diz que a conta está suspensa."}
	errNoLogin = &LoginError{http.StatusConflict, "no_login",
		"Nenhum login em andamento — comece de novo."}
	errLoginCancelled  = &LoginError{http.StatusConflict, "cancelled", "Login cancelado."}
	errApprovalExpired = &LoginError{http.StatusBadRequest, "approval_expired",
		"A aprovação no outro aparelho expirou ou foi recusada. Comece o login de novo."}
	errRecaptcha = &LoginError{http.StatusBadRequest, "recaptcha",
		"O Instagram pediu o captcha do Google (“não sou um robô”), que não dá para resolver pelo app. Num computador, tente “entrar pelo site”."}
)

type caaStep struct {
	field     string
	fieldType bridgev2.LoginInputFieldType
	name      string
	// instructions replace Instagram's; empty keeps its own (dialogs carry their message)
	instructions string
}

// Android-app (CAA) steps we can render safely: one field, known id/type. The app login and the
// web login's CAA fallback share them.
var caaSafeSteps = map[string]caaStep{
	caaPrefix + "password":    {"password", bridgev2.LoginInputFieldTypePassword, "Senha", "Digite a senha do Instagram de novo."},
	caaPrefix + "otp_code":    {"otp_code", bridgev2.LoginInputFieldType2FACode, "Código", "Digite o código de verificação do Instagram."},
	caaPrefix + "backup_code": {"backup_code", bridgev2.LoginInputFieldType2FACode, "Código de backup", "Digite um dos códigos de backup do Instagram."},
	caaPrefix + "totp":        {"totp_code", bridgev2.LoginInputFieldType2FACode, "Código de 6 dígitos", "Digite o código do app autenticador."},
	caaPrefix + "sms":         {"sms_code", bridgev2.LoginInputFieldType2FACode, "Código de 6 dígitos", "Digite o código que o Instagram mandou por SMS."},
	caaPrefix + "whatsapp":    {"whatsapp_code", bridgev2.LoginInputFieldType2FACode, "Código de 6 dígitos", "Digite o código que o Instagram mandou no WhatsApp."},
	caaPrefix + "captcha": {"captcha_code", bridgev2.LoginInputFieldTypeCaptchaCode, "Letras da imagem",
		"O Instagram pediu um captcha: digite as letras e números da imagem."},
	caaPrefix + "mfa_type":             {"mfatype", bridgev2.LoginInputFieldTypeSelect, "Como confirmar", "Escolha como confirmar este login."},
	caaPrefix + "choose_contact_point": {"contact_point", bridgev2.LoginInputFieldTypeSelect, "Para onde", "Escolha para onde o Instagram manda o código."},
	caaPrefix + "dialog":               {"dialog_action", bridgev2.LoginInputFieldTypeSelect, "Continuar", ""},
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

	// native logs in as the Android app (the default); false is the website login
	native bool

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

// fromBridgeStep converts the input, approval and CAPTCHA steps understood by the CRM.
func fromBridgeStep(s *bridgev2.LoginStep) (*Step, error) {
	switch s.Type {
	case bridgev2.LoginStepTypeUserInput:
		if s.UserInputParams == nil {
			return nil, errUnsupportedStep
		}
		out := &Step{Type: "input", StepID: s.StepID, Instructions: s.Instructions,
			Image: captchaImage(s.UserInputParams.Attachments)}
		for _, f := range s.UserInputParams.Fields {
			out.Fields = append(out.Fields, Field{ID: f.ID, Name: f.Name, Type: string(f.Type), Options: f.Options})
		}
		return out, nil
	case bridgev2.LoginStepTypeDisplayAndWait:
		if s.StepID == stepApprove {
			return fromApproveStep(s)
		}
		if s.DisplayAndWaitParams == nil || s.DisplayAndWaitParams.Type != bridgev2.LoginDisplayTypeNothing {
			return nil, errUnsupportedStep
		}
		return &Step{Type: "wait", StepID: s.StepID, Instructions: s.Instructions}, nil
	case bridgev2.LoginStepTypeCookies:
		return fromCaptchaStep(s)
	}
	return nil, errUnsupportedStep
}

// fromApproveStep is Instagram's "was this you?" on a device already signed in, sometimes with a
// number to tap there; instameow's English text is replaced.
func fromApproveStep(s *bridgev2.LoginStep) (*Step, error) {
	params := s.DisplayAndWaitParams
	if params == nil || params.ImageURL != "" {
		return nil, errUnsupportedStep
	}
	out := &Step{Type: "wait", StepID: s.StepID, Back: params.CanCancel,
		Instructions: "Abra o Instagram num aparelho em que a conta já está conectada e aprove este login. Depois toque em “já aprovei”."}
	switch params.Type {
	case bridgev2.LoginDisplayTypeNothing:
		if params.Data != "" {
			return nil, errUnsupportedStep
		}
	case bridgev2.LoginDisplayTypeCode:
		if !approvalCodeRe.MatchString(params.Data) {
			return nil, errUnsupportedStep
		}
		out.Code = params.Data
		out.Instructions = "Abra o Instagram num aparelho em que a conta já está conectada e aprove este login — se ele pedir um número, toque neste. Depois toque em “já aprovei”."
	default:
		return nil, errUnsupportedStep
	}
	return out, nil
}

// stillWaiting is the approval step again after a poll ran out with nothing decided yet.
func stillWaiting(s *Step) *Step {
	again := *s
	again.Instructions = "Ainda não chegou a aprovação. Aprove no Instagram do outro aparelho e toque em “já aprovei” de novo."
	return &again
}

// pollApproval runs one approval poll under limit; waiting reports one that ran out undecided
// while the caller's own context was still alive.
func pollApproval(ctx context.Context, limit time.Duration,
	poll func(context.Context) (*bridgev2.LoginStep, error)) (*bridgev2.LoginStep, bool, error) {
	bounded, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	step, err := poll(bounded)
	waiting := err != nil && errors.Is(bounded.Err(), context.DeadlineExceeded) && ctx.Err() == nil
	return step, waiting, err
}

func fromCaptchaStep(s *bridgev2.LoginStep) (*Step, error) {
	params := s.CookiesParams
	if s.StepID != instameow.InstagramWebCaptchaStepID || params == nil || params.Hidden ||
		params.URL != "https://www.instagram.com/accounts/login/" || len(params.Fields) != 1 {
		return nil, errUnsupportedStep
	}
	field := params.Fields[0]
	if field.ID != fieldCaptcha || !field.Required || len(field.Sources) != 1 ||
		field.Sources[0].Type != bridgev2.LoginCookieTypeSpecial || field.Sources[0].Name != fieldCaptcha {
		return nil, errUnsupportedStep
	}
	// Instameow supplies the widget configuration as a JSON argument to its native webview script.
	// Only forward the data the CRM needs to load the provider's iframe.
	script := strings.TrimSpace(params.ExtractJS)
	start := strings.LastIndex(script, ")({")
	var captcha Captcha
	if start < 0 || !strings.HasSuffix(script, "})") ||
		json.Unmarshal([]byte(script[start+2:len(script)-1]), &captcha) != nil ||
		len(captcha.Instance) != 36 {
		return nil, errCheckpointUnsupported
	}
	frameURL, err := url.Parse(captcha.IframeURL)
	if err != nil || frameURL.Scheme != "https" || frameURL.Host != "www.fbsbx.com" ||
		frameURL.User != nil || frameURL.EscapedPath() != "/captcha/recaptcha/iframe/" || frameURL.Fragment != "" {
		return nil, errCheckpointUnsupported
	}
	instructions := "O Instagram pediu um captcha para continuar o login."
	// instameow's retry notices (token rejected, expired or reused); its default text means a first try
	if strings.HasPrefix(s.Instructions, "Instagram rejected") || strings.HasPrefix(s.Instructions, "Complete a fresh") {
		instructions = "O Instagram recusou esse código ou ele expirou (vale 2 minutos). Resolva um captcha novo."
	}
	return &Step{Type: "captcha", StepID: s.StepID, Captcha: &captcha, Instructions: instructions}, nil
}

func sanitizeCAAStep(step *bridgev2.LoginStep) error {
	if step == nil {
		return nil
	}
	if step.StepID == caaPrefix+"recaptcha" {
		return errRecaptcha
	}
	if step.CookiesParams != nil || step.ClientHTTPParams != nil || step.WebAuthnParams != nil || step.CompleteParams != nil {
		return errUnsupportedStep
	}
	if step.Type == bridgev2.LoginStepTypeDisplayAndWait {
		if step.StepID != caaPrefix+"afad_wait" || step.UserInputParams != nil ||
			step.DisplayAndWaitParams == nil || step.DisplayAndWaitParams.Type != bridgev2.LoginDisplayTypeNothing ||
			step.DisplayAndWaitParams.Data != "" || step.DisplayAndWaitParams.ImageURL != "" {
			return errUnsupportedStep
		}
		step.Instructions = "Aprove este login pela notificação do Instagram e depois continue."
		return nil
	}
	spec, ok := caaSafeSteps[step.StepID]
	if !ok || step.Type != bridgev2.LoginStepTypeUserInput || step.DisplayAndWaitParams != nil ||
		step.UserInputParams == nil || len(step.UserInputParams.Fields) != 1 {
		return errUnsupportedStep
	}
	params := step.UserInputParams
	if spec.fieldType == bridgev2.LoginInputFieldTypeCaptchaCode {
		if captchaImage(params.Attachments) == "" {
			return errUnsupportedStep
		}
	} else if len(params.Attachments) != 0 {
		return errUnsupportedStep
	}
	field := &params.Fields[0]
	if field.ID != spec.field || field.Type != spec.fieldType {
		return errUnsupportedStep
	}
	if spec.fieldType == bridgev2.LoginInputFieldTypeSelect {
		if !boundedOptions(field.Options) {
			return errUnsupportedStep
		}
	} else if field.DefaultValue != "" || len(field.Options) != 0 {
		return errUnsupportedStep
	}
	field.Name, field.Description, field.Pattern, field.DefaultValue = spec.name, "", "", ""
	switch {
	case spec.instructions != "":
		// a retry carries Instagram's own error instead of the default prompt
		if spec.fieldType == bridgev2.LoginInputFieldTypeCaptchaCode && step.Instructions != "Instagram requires solving a captcha" {
			step.Instructions = "Não foi dessa vez — digite as letras e números da imagem nova."
		} else {
			step.Instructions = spec.instructions
		}
	case step.Instructions == "" || utf8.RuneCountInString(step.Instructions) > 500:
		step.Instructions = "O Instagram mostrou um aviso. Escolha como continuar."
	}
	return nil
}

// boundedOptions accepts a short list of short, printable choices.
func boundedOptions(options []string) bool {
	if len(options) == 0 || len(options) > 10 {
		return false
	}
	for _, o := range options {
		if o == "" || utf8.RuneCountInString(o) > 120 || strings.ContainsFunc(o, unicode.IsControl) {
			return false
		}
	}
	return true
}

// captchaImage is the first raster image attachment as a data: URL, or "" when there's none fit to show.
func captchaImage(attachments []*bridgev2.LoginUserInputAttachment) string {
	for _, a := range attachments {
		if a == nil || a.Type != event.MsgImage {
			continue
		}
		if !captchaImageTypes[a.Info.MimeType] || len(a.Content) == 0 || len(a.Content) > maxCaptchaImage {
			return ""
		}
		return "data:" + a.Info.MimeType + ";base64," + base64.StdEncoding.EncodeToString(a.Content)
	}
	return ""
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

// LoginStart begins a password login; device is the stored Android identity, if any. It logs in as
// the Android app unless web: the app's checks (codes, approvals, a letters captcha) can be answered
// from the CRM on a phone, where the website's reCAPTCHA can't.
func (m *Manager) LoginStart(device *types.InstagramLoginDevice, web bool) (*Step, error) {
	m.loginMu.Lock()
	defer m.loginMu.Unlock()
	p := &loginProc{m: m, device: device, started: time.Now(), native: !web}
	c := &cookies.Cookies{Platform: types.Instagram}
	c.UpdateValues(nil)
	cli, err := m.newClient(c, device, nil, func(d types.InstagramLoginDevice) { p.device = &d })
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
	cli, err := p.m.newClient(c, p.device, nil, func(d types.InstagramLoginDevice) { p.device = &d })
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
		if p.client.HasInstagramWebCaptcha() {
			pending := p.m.pendingLoginStep()
			if pending == nil || pending.Captcha == nil {
				return nil, errNoLogin
			}
			if input[fieldCaptchaID] != pending.Captcha.Instance {
				return pending, nil
			}
			step, err := p.client.SubmitInstagramWebCaptcha(ctx, input[fieldCaptcha])
			return p.handleAuthPlatform(ctx, step, err)
		}
		if pending := p.m.pendingLoginStep(); pending != nil && pending.StepID == stepApprove {
			step, waiting, err := pollApproval(ctx, approvalPoll, func(c context.Context) (*bridgev2.LoginStep, error) {
				return p.client.DoInstagramWebAuthPlatformSteps(c, input)
			})
			if waiting {
				return p.remember(stillWaiting(pending), nil)
			}
			return p.handleAuthPlatform(ctx, step, err)
		}
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
	if p.native {
		p.caaIdentifier = identifier
		return p.continueCAA(ctx, map[string]string{fieldIdentifier: identifier, fieldPassword: password})
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
	case errors.Is(err, instameow.ErrInstagramAuthPlatformApprovalExpired):
		return nil, errApprovalExpired
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
	var step *bridgev2.LoginStep
	var err error
	if p.native {
		step, err = p.client.DoInstagramCAALoginSteps(ctx, input)
	} else {
		step, err = p.client.DoInstagramCAALoginStepsExactAccount(ctx, input, p.caaIdentifier, p.caaUserID)
	}
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
	if p.native {
		return p.completeNative(ctx)
	}
	identifier, password := p.caaIdentifier, p.caaPassword
	p.clearCAA()
	return p.submitCredentials(ctx, identifier, password, false)
}

// completeNative finishes an app login: the token goes along with the cookies the app login set.
func (p *loginProc) completeNative(ctx context.Context) (*Step, error) {
	// read both before clearCAA, which drops the token from the client
	jar := cookiesFrom(cookieValues(p.client.GetCookies()))
	native := nativeFor(p.client.GetInstagramNativeSession(), jar)
	p.clearCAA()
	if native == nil {
		return nil, errCAAFailed
	}
	return p.m.completeLogin(ctx, jar, p.device, native)
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
	return p.m.completeLogin(ctx, p.client.GetCookies(), p.device, nil)
}

func fromRespError(re bridgev2.RespError) *LoginError {
	status := re.StatusCode
	if status == 0 {
		status = http.StatusBadRequest
	}
	return &LoginError{Status: status, Code: strings.ToLower(strings.TrimPrefix(re.ErrCode, "FI.MAU.META_")), Message: re.Err}
}

// completeLogin validates fresh cookies (and an app login's token) with a real index load, then hands
// that client to the manager.
func (m *Manager) completeLogin(ctx context.Context, c *cookies.Cookies, device *types.InstagramLoginDevice,
	native *types.InstagramNativeSession) (*Step, error) {
	if missing := c.GetMissingCookieNames(); len(missing) > 0 {
		return nil, &LoginError{http.StatusBadRequest, "missing_cookies",
			fmt.Sprintf("Faltam cookies obrigatórios: %v", missing)}
	}
	values := cookieValues(c)
	cli, err := m.newClient(cookiesFrom(values), device, native, nil)
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
	if native != nil && native.UserID != viewer.ID {
		return nil, errCAAFailed
	}
	// the first connect has no catch-up floor: an existing inbox isn't imported as leads
	m.launch(cli, viewer, mailbox, device, 0)
	return &Step{
		Type:         "complete",
		StepID:       "instagram.complete",
		Instructions: fmt.Sprintf("Conectado como @%s.", viewer.GetUsername()),
		Account:      &Account{Username: viewer.GetUsername(), Name: viewer.GetName(), IGID: viewer.ID},
		Session:      &Session{Cookies: values, Device: device, Native: native},
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
	return m.completeLogin(ctx, cookiesFrom(values), device, nil)
}

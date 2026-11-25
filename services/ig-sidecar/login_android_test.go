package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"go.mau.fi/mautrix-meta/pkg/messagix/cookies"
	"go.mau.fi/mautrix-meta/pkg/messagix/types"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/event"
)

// a 1×1 PNG
var tinyPNG = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89}

func caaInput(stepID, instructions string, field bridgev2.LoginInputDataField, attachments ...*bridgev2.LoginUserInputAttachment) *bridgev2.LoginStep {
	return &bridgev2.LoginStep{Type: bridgev2.LoginStepTypeUserInput, StepID: stepID, Instructions: instructions,
		UserInputParams: &bridgev2.LoginUserInputParams{Fields: []bridgev2.LoginInputDataField{field}, Attachments: attachments}}
}

func image(mime string, content []byte) *bridgev2.LoginUserInputAttachment {
	return &bridgev2.LoginUserInputAttachment{Type: event.MsgImage, Content: content,
		Info: bridgev2.LoginUserInputAttachmentInfo{MimeType: mime, Size: len(content)}}
}

func TestAndroidLettersCaptcha(t *testing.T) {
	field := bridgev2.LoginInputDataField{ID: "captcha_code", Name: "Captcha code", Type: bridgev2.LoginInputFieldTypeCaptchaCode}
	audio := &bridgev2.LoginUserInputAttachment{Type: event.MsgAudio, Content: []byte("ogg"), Info: bridgev2.LoginUserInputAttachmentInfo{MimeType: "audio/ogg"}}

	step := caaInput(caaPrefix+"captcha", "Instagram requires solving a captcha", field, image("image/png", tinyPNG), audio)
	if err := sanitizeCAAStep(step); err != nil {
		t.Fatal(err)
	}
	out, err := fromBridgeStep(step)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(out.Image, "data:image/png;base64,") || len(out.Fields) != 1 || out.Fields[0].ID != "captcha_code" ||
		!strings.Contains(out.Instructions, "letras") {
		t.Fatalf("unexpected step: %+v", out)
	}

	retry := caaInput(caaPrefix+"captcha", "The code you entered was wrong", field, image("image/png", tinyPNG))
	if err := sanitizeCAAStep(retry); err != nil || !strings.HasPrefix(retry.Instructions, "Não foi dessa vez") {
		t.Fatalf("retry: %v %q", err, retry.Instructions)
	}

	for name, bad := range map[string]*bridgev2.LoginStep{
		"svg":         caaInput(caaPrefix+"captcha", "", field, image("image/svg+xml", []byte("<svg/>"))),
		"too big":     caaInput(caaPrefix+"captcha", "", field, image("image/png", make([]byte, maxCaptchaImage+1))),
		"no image":    caaInput(caaPrefix+"captcha", "", field, audio),
		"img on 2fa":  caaInput(caaPrefix+"otp_code", "", bridgev2.LoginInputDataField{ID: "otp_code", Type: bridgev2.LoginInputFieldType2FACode}, image("image/png", tinyPNG)),
		"wrong field": caaInput(caaPrefix+"captcha", "", bridgev2.LoginInputDataField{ID: "other", Type: bridgev2.LoginInputFieldTypeCaptchaCode}, image("image/png", tinyPNG)),
	} {
		if err := sanitizeCAAStep(bad); err != errUnsupportedStep {
			t.Errorf("%s: got %v, want errUnsupportedStep", name, err)
		}
	}
}

func TestAndroidChoiceSteps(t *testing.T) {
	sel := func(id string, options ...string) bridgev2.LoginInputDataField {
		return bridgev2.LoginInputDataField{ID: id, Name: "x", Type: bridgev2.LoginInputFieldTypeSelect, Options: options, DefaultValue: options[0]}
	}
	mfa := caaInput(caaPrefix+"mfa_type", "Choose how to finish signing in", sel("mfatype", "SMS", "WhatsApp"))
	if err := sanitizeCAAStep(mfa); err != nil || mfa.Instructions != "Escolha como confirmar este login." {
		t.Fatalf("mfa: %v %q", err, mfa.Instructions)
	}
	out, _ := fromBridgeStep(mfa)
	if out.Fields[0].Type != "select" || len(out.Fields[0].Options) != 2 {
		t.Fatalf("mfa step: %+v", out)
	}

	dialog := caaInput(caaPrefix+"dialog", "Confira suas notificações", sel("dialog_action", "Continuar", "Tentar outro método"))
	if err := sanitizeCAAStep(dialog); err != nil || dialog.Instructions != "Confira suas notificações" {
		t.Fatalf("dialog keeps Instagram's message: %v %q", err, dialog.Instructions)
	}
	long := caaInput(caaPrefix+"dialog", strings.Repeat("a", 501), sel("dialog_action", "OK"))
	if err := sanitizeCAAStep(long); err != nil || long.Instructions != "O Instagram mostrou um aviso. Escolha como continuar." {
		t.Fatalf("long dialog: %v %q", err, long.Instructions)
	}

	many := make([]string, 11)
	for i := range many {
		many[i] = "x"
	}
	for name, bad := range map[string]*bridgev2.LoginStep{
		"too many options": caaInput(caaPrefix+"choose_contact_point", "", sel("contact_point", many...)),
		"control char":     caaInput(caaPrefix+"mfa_type", "", sel("mfatype", "SMS\x00")),
		"unknown step":     caaInput(caaPrefix+"account_selection", "", sel("account", "a")),
	} {
		if err := sanitizeCAAStep(bad); err != errUnsupportedStep {
			t.Errorf("%s: got %v, want errUnsupportedStep", name, err)
		}
	}
}

func TestAndroidRecaptchaIsNamed(t *testing.T) {
	step := &bridgev2.LoginStep{Type: bridgev2.LoginStepTypeCookies, StepID: caaPrefix + "recaptcha",
		CookiesParams: &bridgev2.LoginCookiesParams{URL: "https://www.instagram.com/x"}}
	if err := sanitizeCAAStep(step); err != errRecaptcha {
		t.Fatalf("got %v, want errRecaptcha", err)
	}
}

func TestNativeFor(t *testing.T) {
	jar := cookiesFrom(map[string]string{string(cookies.IGCookieDSUserID): "42"})
	ok := &types.InstagramNativeSession{Authorization: "Bearer IGT:2:x", UserID: "42"}
	if nativeFor(ok, jar) != ok {
		t.Fatal("matching token dropped")
	}
	for name, n := range map[string]*types.InstagramNativeSession{
		"nil":           nil,
		"no auth":       {UserID: "42"},
		"other account": {Authorization: "Bearer IGT:2:x", UserID: "7"},
	} {
		if nativeFor(n, jar) != nil {
			t.Errorf("%s: kept", name)
		}
	}
}

func TestSessionCarriesNative(t *testing.T) {
	in := Session{Cookies: map[string]string{"sessionid": "s"}, Native: &types.InstagramNativeSession{Authorization: "Bearer IGT:2:x", UserID: "42"}}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out Session
	if err = json.Unmarshal(b, &out); err != nil || out.Native == nil || out.Native.Authorization != "Bearer IGT:2:x" {
		t.Fatalf("round trip lost the token: %s", b)
	}
	if b, _ = json.Marshal(Session{Cookies: map[string]string{}}); strings.Contains(string(b), "native") {
		t.Fatalf("cookie-only session grew a native field: %s", b)
	}
}

func TestLoginStartDefaultsToApp(t *testing.T) {
	m := newManager(config{}, zerolog.Nop(), nil)
	for _, web := range []bool{false, true} {
		step, err := m.LoginStart(nil, web)
		if err != nil || step.StepID != stepCredentials {
			t.Fatalf("web=%v: %v %+v", web, err, step)
		}
		if m.login.native == web {
			t.Fatalf("web=%v started native=%v", web, m.login.native)
		}
		m.LoginCancel()
	}
}

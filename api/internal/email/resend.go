// Package email provides a stateless email sender backed by Resend.
// All configuration (API key, sender address, etc.) is supplied per-call
// so that admin-panel changes take effect immediately without restart.
package email

import (
	"bytes"
	"fmt"
	"log"
	"text/template"

	"github.com/resend/resend-go/v2"
)

// TemplateData holds the magic variables available inside email templates.
//
//	{{.SiteName}}  — site name
//	{{.Link}}      — action URL (verification / reset link)
//	{{.UserEmail}} — recipient email address
type TemplateData struct {
	SiteName  string
	Link      string
	UserEmail string
}

// Service is a stateless email sender.
type Service struct{}

// New returns a Service. No configuration needed at construction time.
func New() *Service { return &Service{} }

// SendVerification sends a verification email using the given settings.
// appURL and siteName come from the application config (not DB settings).
func (s *Service) SendVerification(
	apiKey, from, subject, tmplHTML, appURL, siteName, to, token string,
) error {
	if subject == "" {
		subject = fmt.Sprintf("验证您的 %s 邮箱", siteName)
	}
	link := fmt.Sprintf("%s/verify-email?token=%s", appURL, token)
	return s.send(apiKey, from, subject, to, tmplHTML, TemplateData{
		SiteName:  siteName,
		Link:      link,
		UserEmail: to,
	}, defaultVerifyTemplate)
}

// SendPasswordReset sends a password-reset email using the given settings.
func (s *Service) SendPasswordReset(
	apiKey, from, subject, tmplHTML, appURL, siteName, to, token string,
) error {
	if subject == "" {
		subject = fmt.Sprintf("%s 密码重置", siteName)
	}
	link := fmt.Sprintf("%s/reset-password?token=%s", appURL, token)
	return s.send(apiKey, from, subject, to, tmplHTML, TemplateData{
		SiteName:  siteName,
		Link:      link,
		UserEmail: to,
	}, defaultResetTemplate)
}

// send renders the template and dispatches the email.
// If apiKey is empty the rendered link is logged and nil is returned.
func (s *Service) send(
	apiKey, from, subject, to, tmplHTML string,
	data TemplateData, fallback string,
) error {
	html, err := renderTemplate(tmplHTML, fallback, data)
	if err != nil {
		return fmt.Errorf("email: render template: %w", err)
	}
	if apiKey == "" {
		log.Printf("email [dev] to=%s subject=%q link=%s", to, subject, data.Link)
		return nil
	}
	client := resend.NewClient(apiKey)
	_, err = client.Emails.Send(&resend.SendEmailRequest{
		From:    from,
		To:      []string{to},
		Subject: subject,
		Html:    html,
	})
	return err
}

// renderTemplate executes a Go text/template.
// Falls back to the built-in template when tmpl is empty or fails to parse.
func renderTemplate(tmpl, fallback string, data TemplateData) (string, error) {
	src := tmpl
	if src == "" {
		src = fallback
	}
	t, err := template.New("e").Parse(src)
	if err != nil {
		// Bad admin template — fall back to built-in rather than failing silently
		log.Printf("email: invalid template, using built-in: %v", err)
		t, _ = template.New("e").Parse(fallback)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// ─── Built-in default templates ───────────────────────────────────────────────

const defaultVerifyTemplate = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f5f5f5;padding:40px 0;margin:0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h1 style="color:#1C1B1F;font-size:22px;margin:0 0 16px">验证您的邮箱</h1>
    <p style="color:#49454F;font-size:15px;line-height:1.6;margin:0 0 28px">
      感谢注册 {{.SiteName}}！请点击下方按钮完成邮箱验证。
    </p>
    <a href="{{.Link}}"
       style="display:inline-block;background:#6750A4;color:#fff;text-decoration:none;
              padding:12px 28px;border-radius:100px;font-size:14px;font-weight:500">
      验证邮箱
    </a>
    <p style="color:#79747E;font-size:13px;margin:28px 0 0">
      链接有效期 24 小时。如果不是您本人操作，请忽略此邮件。
    </p>
  </div>
</body>
</html>`

const defaultResetTemplate = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f5f5f5;padding:40px 0;margin:0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <h1 style="color:#1C1B1F;font-size:22px;margin:0 0 16px">重置您的密码</h1>
    <p style="color:#49454F;font-size:15px;line-height:1.6;margin:0 0 28px">
      我们收到了您的密码重置请求。请点击下方按钮设置新密码。
    </p>
    <a href="{{.Link}}"
       style="display:inline-block;background:#6750A4;color:#fff;text-decoration:none;
              padding:12px 28px;border-radius:100px;font-size:14px;font-weight:500">
      重置密码
    </a>
    <p style="color:#79747E;font-size:13px;margin:28px 0 0">
      链接有效期 1 小时。如果不是您本人操作，请忽略此邮件，您的密码不会被更改。
    </p>
  </div>
</body>
</html>`

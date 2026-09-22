// Package payment provides thin wrappers around third-party payment SDKs.
//
// Stripe is configured per-request from values stored in the encrypted
// system_settings table (admin can rotate keys without restarting the
// service). The package intentionally has no DB or HTTP dependencies — it
// just translates a simple input struct into Stripe SDK calls.
package payment

import (
	"errors"
	"fmt"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/webhook"
)

// CheckoutInput is the input for creating a Stripe Checkout Session.
//
// Two UI modes are supported:
//   - Hosted (default): Stripe-hosted checkout page; requires SuccessURL/CancelURL.
//   - Embedded:         Mounts inside an iframe in our own page; the result
//                       carries a ClientSecret instead of a redirect URL.
type CheckoutInput struct {
	SecretKey   string
	Currency    string // ISO-4217 lowercase, e.g. "usd"
	Title       string
	Description string
	AmountCents int64

	// Embedded turns on ui_mode=embedded. When true, ReturnURL is used and
	// SuccessURL/CancelURL are ignored.
	Embedded  bool
	ReturnURL string // embedded mode (used as fallback for redirect-based payment methods)

	// Hosted-mode redirect URLs (only used when Embedded=false).
	SuccessURL string
	CancelURL  string

	Email    string
	Metadata map[string]string
}

// CheckoutResult holds the data the frontend needs to render the checkout.
// In hosted mode `URL` is the redirect target; in embedded mode `ClientSecret`
// is fed into Stripe.js initEmbeddedCheckout.
type CheckoutResult struct {
	SessionID    string
	URL          string
	ClientSecret string
}

// CreateCheckoutSession creates a one-off Stripe Checkout Session in payment mode.
func CreateCheckoutSession(in CheckoutInput) (*CheckoutResult, error) {
	if in.SecretKey == "" {
		return nil, errors.New("stripe secret key is not configured")
	}
	if in.AmountCents <= 0 {
		return nil, errors.New("amount must be positive")
	}
	if !in.Embedded && (in.SuccessURL == "" || in.CancelURL == "") {
		return nil, errors.New("success_url and cancel_url are required for hosted mode")
	}
	currency := in.Currency
	if currency == "" {
		currency = "usd"
	}

	// stripe-go uses a global key. Setting it per-call is acceptable for our
	// single-tenant deployment; if Stripe credentials change in admin settings
	// the next request picks them up automatically.
	stripe.Key = in.SecretKey

	productData := &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
		Name: stripe.String(in.Title),
	}
	if in.Description != "" {
		productData.Description = stripe.String(in.Description)
	}

	params := &stripe.CheckoutSessionParams{
		Mode: stripe.String(string(stripe.CheckoutSessionModePayment)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency:    stripe.String(currency),
					ProductData: productData,
					UnitAmount:  stripe.Int64(in.AmountCents),
				},
				Quantity: stripe.Int64(1),
			},
		},
	}
	if in.Embedded {
		params.UIMode = stripe.String(string(stripe.CheckoutSessionUIModeEmbedded))
		// `if_required` keeps card payments inside the embedded iframe (so the
		// onComplete callback fires) BUT still allows redirect-based payment
		// methods like Alipay / WeChat Pay / Klarna / 3DS, which need to take
		// the customer off-site and bring them back via return_url.
		//
		// Using `never` would forcibly disable every redirect-based method —
		// notably hiding Alipay / WeChat Pay from the form entirely.
		params.RedirectOnCompletion = stripe.String(string(stripe.CheckoutSessionRedirectOnCompletionIfRequired))
		if in.ReturnURL == "" {
			return nil, errors.New("return_url is required for embedded mode")
		}
		params.ReturnURL = stripe.String(in.ReturnURL)
	} else {
		params.SuccessURL = stripe.String(in.SuccessURL)
		params.CancelURL = stripe.String(in.CancelURL)
	}
	if in.Email != "" {
		params.CustomerEmail = stripe.String(in.Email)
	}
	if len(in.Metadata) > 0 {
		params.Metadata = in.Metadata
	}

	s, err := session.New(params)
	if err != nil {
		return nil, fmt.Errorf("create stripe checkout session: %w", err)
	}
	return &CheckoutResult{
		SessionID:    s.ID,
		URL:          s.URL,
		ClientSecret: s.ClientSecret,
	}, nil
}

// GetCheckoutSession fetches a Checkout Session by ID. Used by the success
// page to confirm payment status without trusting the redirect parameters.
func GetCheckoutSession(secretKey, sessionID string) (*stripe.CheckoutSession, error) {
	if secretKey == "" {
		return nil, errors.New("stripe secret key is not configured")
	}
	stripe.Key = secretKey
	return session.Get(sessionID, nil)
}

// VerifyWebhook validates a Stripe webhook payload signature.
// Returns the parsed event on success.
func VerifyWebhook(payload []byte, signatureHeader, secret string) (*stripe.Event, error) {
	if secret == "" {
		return nil, errors.New("stripe webhook secret is not configured")
	}
	event, err := webhook.ConstructEvent(payload, signatureHeader, secret)
	if err != nil {
		return nil, fmt.Errorf("verify stripe webhook: %w", err)
	}
	return &event, nil
}

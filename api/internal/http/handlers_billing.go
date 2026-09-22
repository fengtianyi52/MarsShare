package httpapi

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/marsshare/api/internal/payment"
	"github.com/marsshare/api/internal/store"
	"github.com/stripe/stripe-go/v82"
)

// ────────────────────────────────────────────────────────────
// Wallet
// ────────────────────────────────────────────────────────────

func (h *Handler) wallet(c *gin.Context) {
	ctx := c.Request.Context()
	userID := getUserID(c)

	balance, ledger, err := h.store.GetWallet(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load wallet")
		return
	}
	memberships, err := h.store.ListUserMemberships(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load memberships")
		return
	}
	ok(c, gin.H{
		"balance_cents": balance,
		"ledger":        ledger,
		"memberships":   memberships,
	})
}

// ────────────────────────────────────────────────────────────
// Plans
// ────────────────────────────────────────────────────────────

func (h *Handler) plans(c *gin.Context) {
	ctx := c.Request.Context()
	items, err := h.store.ListMembershipPlans(ctx)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load plans")
		return
	}
	ok(c, gin.H{"items": items})
}

// ────────────────────────────────────────────────────────────
// Purchase membership
// ────────────────────────────────────────────────────────────

func (h *Handler) purchaseMembership(c *gin.Context) {
	var req struct {
		PlanID string `json:"plan_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "plan_id is required")
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)

	if err := h.store.PurchaseMembership(ctx, userID, req.PlanID); err != nil {
		code := CodeInternalError
		status := http.StatusInternalServerError
		msg := err.Error()
		if strings.Contains(msg, "insufficient") || strings.Contains(msg, "balance") {
			code = CodeInsufficientBal
			status = http.StatusPaymentRequired
		}
		errorResponse(c, status, code, msg)
		return
	}
	ok(c, gin.H{"purchased": true})
}

// ────────────────────────────────────────────────────────────
// Redeem
// ────────────────────────────────────────────────────────────

func (h *Handler) redeem(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "code is required")
		return
	}

	ctx := c.Request.Context()
	userID := getUserID(c)
	code := strings.ToUpper(strings.TrimSpace(req.Code))

	if err := h.store.RedeemCode(ctx, userID, code); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "invalid or already redeemed code")
		return
	}
	ok(c, gin.H{"redeemed": true})
}

// stripeMinCharge is the smallest amount Stripe will accept for the given
// currency, expressed in the currency's smallest unit (cents/分/etc.). Source:
// https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
//
// We validate against this server-side to surface a clean 400 instead of
// letting Stripe return an opaque error which we can only forward as 502.
var stripeMinCharge = map[string]int64{
	"usd": 50,
	"aed": 200,
	"aud": 50,
	"bgn": 100,
	"brl": 50,
	"cad": 50,
	"chf": 50,
	"czk": 1500,
	"dkk": 250,
	"eur": 50,
	"gbp": 30,
	"hkd": 400,
	"huf": 17500,
	"inr": 50,
	"jpy": 50,
	"mxn": 1000,
	"myr": 200,
	"nok": 300,
	"nzd": 50,
	"pln": 200,
	"ron": 200,
	"sek": 300,
	"sgd": 50,
	"thb": 1000,
	"twd": 1000,
	"cny": 350,
}

// ────────────────────────────────────────────────────────────
// Stripe — public config (publishable key + enabled flag)
// ────────────────────────────────────────────────────────────

// stripeConfig returns the publishable key and the resolved currency so the
// frontend knows whether to show the cash-payment buttons. Secret values are
// never returned.
func (h *Handler) stripeConfig(c *gin.Context) {
	cfg := h.store.GetStripeSettings(c.Request.Context())
	ok(c, gin.H{
		"enabled":         cfg.Enabled,
		"publishable_key": cfg.PublishableKey,
		"currency":        cfg.Currency,
		"credit_rate":     cfg.CreditRate,
	})
}

// ────────────────────────────────────────────────────────────
// Stripe — checkout session creation
// ────────────────────────────────────────────────────────────

// stripeCheckout creates a Stripe Checkout Session and returns the redirect URL.
//
// Two flows are supported:
//   - kind = "recharge"  : amount_cents required, credits the wallet
//   - kind = "membership": plan_id required, charges the plan price and
//                          activates the membership inside the webhook
func (h *Handler) stripeCheckout(c *gin.Context) {
	var req struct {
		Kind        string `json:"kind" binding:"required"` // "recharge" | "membership"
		AmountCents int64  `json:"amount_cents"`
		PlanID      string `json:"plan_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "kind is required")
		return
	}

	ctx := c.Request.Context()
	cfg := h.store.GetStripeSettings(ctx)
	if !cfg.Enabled {
		// 422 (not 503) so reverse proxies don't mask the JSON error body.
		errorResponse(c, http.StatusUnprocessableEntity, "STRIPE_DISABLED", "Stripe payments are not enabled")
		return
	}

	userID := getUserID(c)
	user, err := h.store.GetUserByID(ctx, userID)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load user")
		return
	}

	var (
		title       string
		description string
		amountCents int64
		planIDForDB string
	)
	switch req.Kind {
	case "recharge":
		if req.AmountCents <= 0 {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "amount_cents must be positive for recharge")
			return
		}
		amountCents = req.AmountCents
		title = "Wallet Recharge"
		description = "Top up your MarsShare wallet balance"
	case "membership":
		if strings.TrimSpace(req.PlanID) == "" {
			errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "plan_id is required for membership purchase")
			return
		}
		plans, err := h.store.ListMembershipPlans(ctx)
		if err != nil {
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to load plans")
			return
		}
		var matched bool
		for _, p := range plans {
			if p.ID == req.PlanID {
				amountCents = p.PriceCents
				title = p.Name
				description = "Membership purchase"
				planIDForDB = p.ID
				matched = true
				break
			}
		}
		if !matched {
			errorResponse(c, http.StatusNotFound, CodeNotFound, "plan not found")
			return
		}
	default:
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "kind must be recharge or membership")
		return
	}

	// Stripe rejects amounts below a per-currency minimum. Validate before
	// hitting Stripe so the user sees a friendly message — applies to BOTH
	// recharge and membership flows. We attach structured fields (min /
	// amount / currency) so the frontend can render a localised string.
	if min, ok := stripeMinCharge[strings.ToLower(cfg.Currency)]; ok && amountCents < min {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":         "STRIPE_AMOUNT_TOO_SMALL",
				"message":      fmt.Sprintf("amount %d is below the Stripe minimum of %d (%s)", amountCents, min, strings.ToUpper(cfg.Currency)),
				"amount_cents": amountCents,
				"min_cents":    min,
				"currency":     strings.ToUpper(cfg.Currency),
			},
		})
		return
	}

	// Embedded mode with redirect_on_completion=if_required: card payments
	// stay in the iframe and finish via Stripe.js onComplete; redirect-based
	// methods (Alipay, WeChat Pay, Klarna, 3DS, …) navigate the top window
	// to return_url where BillingResultPage takes over the post-payment flow.
	baseURL := strings.TrimRight(h.resolveBaseURL(c), "/")
	returnURL := baseURL + "/billing/success?session_id={CHECKOUT_SESSION_ID}"

	log.Printf("[stripe] creating checkout session: kind=%s amount=%d %s return_url=%s",
		req.Kind, amountCents, strings.ToUpper(cfg.Currency), returnURL)

	result, err := payment.CreateCheckoutSession(payment.CheckoutInput{
		SecretKey:   cfg.SecretKey,
		Currency:    cfg.Currency,
		Title:       title,
		Description: description,
		AmountCents: amountCents,
		Embedded:    true,
		ReturnURL:   returnURL,
		Email:       user.Email,
		Metadata: map[string]string{
			"user_id": userID,
			"kind":    req.Kind,
			"plan_id": planIDForDB,
		},
	})
	if err != nil {
		log.Printf("[stripe] checkout failed: %v", err)
		// Use 422 instead of 502 so reverse proxies with `proxy_intercept_errors`
		// don't replace our JSON body with their own HTML error page — the
		// frontend needs to read the actual Stripe error message.
		errorResponse(c, http.StatusUnprocessableEntity, "STRIPE_ERROR", err.Error())
		return
	}

	if _, err := h.store.CreateStripeOrder(ctx, userID, result.SessionID, req.Kind, planIDForDB, amountCents, cfg.Currency); err != nil {
		log.Printf("persist stripe order failed: %v", err)
		errorResponse(c, http.StatusInternalServerError, CodeInternalError, "failed to record order")
		return
	}

	ok(c, gin.H{
		"session_id":    result.SessionID,
		"url":           result.URL,
		"client_secret": result.ClientSecret,
	})
}

// stripeOrderStatus is hit by the success page to confirm whether a session
// has been fulfilled. If the local order is still pending, we query Stripe
// directly and run fulfilment locally — this makes the system robust when
// webhooks aren't configured (dev) or are delayed.
func (h *Handler) stripeOrderStatus(c *gin.Context) {
	sessionID := c.Param("session_id")
	if sessionID == "" {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "session_id is required")
		return
	}
	ctx := c.Request.Context()
	order, err := h.store.GetStripeOrderBySession(ctx, sessionID)
	if err != nil {
		errorResponse(c, http.StatusNotFound, CodeNotFound, "order not found")
		return
	}
	// Authorisation: only the owner can read their own orders.
	if order.UserID != getUserID(c) {
		errorResponse(c, http.StatusForbidden, CodeForbidden, "forbidden")
		return
	}

	// If still pending, ask Stripe directly. Webhook delivery may be
	// disabled (local dev) or simply slower than the user's redirect.
	if order.Status == "pending" {
		cfg := h.store.GetStripeSettings(ctx)
		if cfg.SecretKey != "" {
			session, err := payment.GetCheckoutSession(cfg.SecretKey, sessionID)
			if err != nil {
				log.Printf("stripe sync session %s failed: %v", sessionID, err)
			} else if session != nil && session.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid {
				pi := ""
				if session.PaymentIntent != nil {
					pi = session.PaymentIntent.ID
				}
				if err := h.store.FulfillStripeOrder(ctx, sessionID, pi, cfg.CreditRate); err != nil {
					log.Printf("sync fulfill stripe order %s failed: %v", sessionID, err)
				} else {
					// Reload to return the updated state.
					if updated, err := h.store.GetStripeOrderBySession(ctx, sessionID); err == nil {
						order = updated
					}
				}
			} else if session != nil && session.Status == stripe.CheckoutSessionStatusExpired {
				_ = h.store.MarkStripeOrderFailed(ctx, sessionID, "canceled")
				if updated, err := h.store.GetStripeOrderBySession(ctx, sessionID); err == nil {
					order = updated
				}
			}
		}
	}
	ok(c, order)
}

// stripeWebhook handles incoming events from Stripe. Signature is verified
// with the configured webhook secret; only checkout.session.completed and
// checkout.session.async_payment_failed are acted on.
func (h *Handler) stripeWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	cfg := h.store.GetStripeSettings(ctx)

	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, CodeInvalidInput, "failed to read body")
		return
	}

	signature := c.GetHeader("Stripe-Signature")
	event, err := payment.VerifyWebhook(payload, signature, cfg.WebhookSecret)
	if err != nil {
		log.Printf("stripe webhook verify failed: %v", err)
		errorResponse(c, http.StatusBadRequest, "INVALID_SIGNATURE", "invalid signature")
		return
	}

	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		// Stripe Event payload contains the session JSON; pull session_id and
		// payment_intent without unmarshalling the full struct.
		sessionID, _ := event.Data.Object["id"].(string)
		paymentIntent, _ := event.Data.Object["payment_intent"].(string)
		if sessionID == "" {
			ok(c, gin.H{"received": true})
			return
		}
		if err := h.store.FulfillStripeOrder(ctx, sessionID, paymentIntent, cfg.CreditRate); err != nil {
			log.Printf("fulfill stripe order %s failed: %v", sessionID, err)
			errorResponse(c, http.StatusInternalServerError, CodeInternalError, "fulfillment failed")
			return
		}
	case "checkout.session.async_payment_failed", "checkout.session.expired":
		sessionID, _ := event.Data.Object["id"].(string)
		if sessionID != "" {
			status := "failed"
			if event.Type == "checkout.session.expired" {
				status = "canceled"
			}
			_ = h.store.MarkStripeOrderFailed(ctx, sessionID, status)
		}
	}
	ok(c, gin.H{"received": true})
}

// resolveBaseURL prefers the admin-configured app_base_url, falls back to
// the env var/config, then finally to the request's scheme/host.
//
// When auto-detecting from the request we look at multiple proxy headers
// (X-Forwarded-Proto, X-Forwarded-Host, Forwarded) and default to https for
// any non-loopback host — Stripe rejects http return URLs in production.
func (h *Handler) resolveBaseURL(c *gin.Context) string {
	if v, _ := h.store.GetSetting(c.Request.Context(), store.SettingAppBaseURL); v != "" {
		return strings.TrimRight(v, "/")
	}
	if h.cfg.AppBaseURL != "" {
		return strings.TrimRight(h.cfg.AppBaseURL, "/")
	}

	host := c.Request.Host
	if v := c.GetHeader("X-Forwarded-Host"); v != "" {
		// Multiple hosts may be comma-separated; take the first.
		if idx := strings.IndexByte(v, ','); idx >= 0 {
			v = v[:idx]
		}
		host = strings.TrimSpace(v)
	}

	scheme := "https"
	switch {
	case c.Request.TLS != nil:
		scheme = "https"
	case strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https"):
		scheme = "https"
	case strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "http"):
		scheme = "http"
	case strings.HasPrefix(host, "localhost") || strings.HasPrefix(host, "127.") || host == "::1":
		// Local development — keep http so Stripe test mode works without TLS.
		scheme = "http"
	}
	return scheme + "://" + host
}

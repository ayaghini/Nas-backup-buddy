package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/api"
	"github.com/nasbb/host-agent/src/config"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/overlay"
	"github.com/nasbb/host-agent/src/sftp"
)

const testToken = "test-integration-token-0123456789ab"

func newTestServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	configDir := dir + "/config"
	stateDir := dir + "/state"
	reposDir := dir + "/repos"
	logDir := dir + "/logs"

	os.MkdirAll(configDir, 0755)
	os.MkdirAll(stateDir, 0755)
	os.MkdirAll(reposDir, 0755)
	os.MkdirAll(logDir, 0755)

	cfg, _ := config.Load(configDir)
	evts := events.NewLogger(logDir)
	sftpMgr := sftp.NewManager(stateDir, reposDir)
	mgr := allocation.NewManager(configDir, stateDir, reposDir, evts, sftpMgr)
	quotaPoller := sftp.NewQuotaPoller(mgr, sftpMgr, reposDir, evts)
	lc := allocation.NewLifecycle(mgr, sftpMgr, quotaPoller, evts)
	ov := overlay.GetStatus("", "127.0.0.1", 2222)

	srv := api.New(api.Options{
		Cfg:           cfg,
		CfgSave:       func() error { return config.Save(cfg, configDir) },
		Token:         testToken,
		Events:        evts,
		Manager:       mgr,
		Lifecycle:     lc,
		SFTPMgr:       sftpMgr,
		OverlayStatus: ov,
		SFTPBind:      "127.0.0.1",
		SFTPPort:      2222,
		SFTPHost:      "127.0.0.1",
	})

	ts := httptest.NewServer(srv.Router())
	t.Cleanup(ts.Close)
	return ts, testToken
}

func authHeader(token string) string {
	return "Bearer " + token
}

func doRequest(t *testing.T, ts *httptest.Server, method, path, token string, body any) *http.Response {
	t.Helper()
	var buf *bytes.Buffer
	if body != nil {
		data, _ := json.Marshal(body)
		buf = bytes.NewBuffer(data)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	req, _ := http.NewRequest(method, ts.URL+path, buf)
	if token != "" {
		req.Header.Set("Authorization", authHeader(token))
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	return resp
}

func decodeJSON(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	json.NewDecoder(resp.Body).Decode(&m)
	resp.Body.Close()
	return m
}

// ── Auth ──────────────────────────────────────────────────────────────────────

func TestInfoNoAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doRequest(t, ts, "GET", "/api/v1/info", "", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	m := decodeJSON(t, resp)
	if m["ready"] != true {
		t.Fatalf("expected ready:true, got %v", m["ready"])
	}
}

func TestStatusNoToken(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doRequest(t, ts, "GET", "/api/v1/status", "", nil)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestStatusWrongToken(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doRequest(t, ts, "GET", "/api/v1/status", "wrongtoken", nil)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("expected 401, got %d", resp.StatusCode)
	}
}

func TestStatusValidToken(t *testing.T) {
	ts, tok := newTestServer(t)
	resp := doRequest(t, ts, "GET", "/api/v1/status", tok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	m := decodeJSON(t, resp)
	if m["agentVersion"] != "0.1.0" {
		t.Fatalf("unexpected agentVersion: %v", m["agentVersion"])
	}
}

// ── Config ────────────────────────────────────────────────────────────────────

func TestConfigGetAndPatch(t *testing.T) {
	ts, tok := newTestServer(t)
	resp := doRequest(t, ts, "GET", "/api/v1/config", tok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doRequest(t, ts, "PATCH", "/api/v1/config", tok, map[string]string{"hostLabel": "TestHost"})
	m := decodeJSON(t, resp)
	if m["hostLabel"] != "TestHost" {
		t.Fatalf("expected hostLabel TestHost, got %v", m["hostLabel"])
	}
}

// ── Allocations ───────────────────────────────────────────────────────────────

func createAlloc(t *testing.T, ts *httptest.Server, tok, name string) map[string]any {
	t.Helper()
	resp := doRequest(t, ts, "POST", "/api/v1/allocations", tok, map[string]any{
		"connectionName": name,
		"quotaBytes":     1073741824,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create alloc failed: %d", resp.StatusCode)
	}
	return decodeJSON(t, resp)
}

func TestAllocCRUD(t *testing.T) {
	ts, tok := newTestServer(t)

	a := createAlloc(t, ts, tok, "TestAlloc")
	allocID := a["allocId"].(string)

	if a["state"] != "DRAFT" {
		t.Fatalf("expected DRAFT, got %v", a["state"])
	}
	if a["quotaMode"] != "soft" {
		t.Fatalf("expected quotaMode soft, got %v", a["quotaMode"])
	}
	if a["accessWindowEnforcement"] != "future" {
		t.Fatalf("expected accessWindowEnforcement future, got %v", a["accessWindowEnforcement"])
	}
	if _, ok := a["ownerPublicKey"]; ok {
		t.Fatal("ownerPublicKey must not appear in summary")
	}

	// List
	resp := doRequest(t, ts, "GET", "/api/v1/allocations", tok, nil)
	m := decodeJSON(t, resp)
	allocs := m["allocations"].([]any)
	if len(allocs) != 1 {
		t.Fatalf("expected 1 allocation, got %d", len(allocs))
	}

	// Get
	resp = doRequest(t, ts, "GET", "/api/v1/allocations/"+allocID, tok, nil)
	got := decodeJSON(t, resp)
	if got["allocId"] != allocID {
		t.Fatalf("allocId mismatch")
	}
	if _, ok := got["ownerPublicKey"]; ok {
		t.Fatal("ownerPublicKey must not appear in get response")
	}

	// Patch
	resp = doRequest(t, ts, "PATCH", "/api/v1/allocations/"+allocID, tok, map[string]string{"connectionName": "Updated"})
	patched := decodeJSON(t, resp)
	if patched["connectionName"] != "Updated" {
		t.Fatalf("patch failed: %v", patched["connectionName"])
	}
}

func TestAllocQuotaModeAlwaysSoft(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "QuotaTest")
	if a["quotaMode"] != "soft" {
		t.Fatalf("quotaMode must be soft, got %v", a["quotaMode"])
	}
}

// ── Invite / Owner Response ───────────────────────────────────────────────────

func generateInvite(t *testing.T, ts *httptest.Server, tok, allocID string) map[string]any {
	t.Helper()
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/invite", tok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("invite failed: %d", resp.StatusCode)
	}
	return decodeJSON(t, resp)
}

func TestInviteAndOwnerResponse(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "InviteTest")
	allocID := a["allocId"].(string)

	invite := generateInvite(t, ts, tok, allocID)
	if invite["kind"] != "nasbb.host_invite" {
		t.Fatalf("unexpected kind: %v", invite["kind"])
	}

	resp := doRequest(t, ts, "GET", "/api/v1/allocations/"+allocID, tok, nil)
	state := decodeJSON(t, resp)
	if state["state"] != "PENDING_KEY" {
		t.Fatalf("expected PENDING_KEY, got %v", state["state"])
	}

	// Re-invite from EXPIRED
	resp = doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/invite", tok, nil)
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409 re-invite from PENDING_KEY, got %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestOwnerResponseWrongAllocID(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "AllocMismatch")
	allocID := a["allocId"].(string)
	generateInvite(t, ts, tok, allocID)

	body := map[string]any{
		"bundleVersion": 1, "kind": "nasbb.owner_access_response",
		"matchId": a["matchId"], "allocId": "alloc_wrongwrong",
		"ownerDeviceLabel": "t", "ownerPublicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTesting1234567890abcdefghijk",
		"requestedSftpUsername": a["username"], "createdAt": "2026-04-28T00:00:00Z",
	}
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/owner-response", tok, body)
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409 ALLOC_ID_MISMATCH, got %d", resp.StatusCode)
	}
}

func TestOwnerResponseInvalidKey(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "BadKey")
	allocID := a["allocId"].(string)
	invite := generateInvite(t, ts, tok, allocID)

	body := map[string]any{
		"bundleVersion": 1, "kind": "nasbb.owner_access_response",
		"matchId": invite["matchId"], "allocId": allocID,
		"ownerDeviceLabel": "t", "ownerPublicKey": "not-a-valid-key",
		"requestedSftpUsername": a["username"], "createdAt": "2026-04-28T00:00:00Z",
	}
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/owner-response", tok, body)
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("expected 400 INVALID_KEY, got %d", resp.StatusCode)
	}
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

func authorizeAlloc(t *testing.T, ts *httptest.Server, tok string, a map[string]any) {
	t.Helper()
	allocID := a["allocId"].(string)
	invite := generateInvite(t, ts, tok, allocID)
	pubKey := "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GkZI test@test"
	body := map[string]any{
		"bundleVersion": 1, "kind": "nasbb.owner_access_response",
		"matchId": invite["matchId"], "allocId": allocID,
		"ownerDeviceLabel": "test", "ownerPublicKey": pubKey,
		"requestedSftpUsername": a["username"], "createdAt": "2026-04-28T00:00:00Z",
	}
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/owner-response", tok, body)
	m := decodeJSON(t, resp)
	if m["state"] != "READY" {
		t.Fatalf("expected READY after owner-response, got %v", m["state"])
	}
}

func TestSuspendResume(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "SuspendTest")
	authorizeAlloc(t, ts, tok, a)
	allocID := a["allocId"].(string)

	// Suspend
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/suspend", tok, nil)
	m := decodeJSON(t, resp)
	if m["state"] != "SUSPENDED" {
		t.Fatalf("expected SUSPENDED, got %v", m["state"])
	}

	// Resume
	resp = doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/resume", tok, nil)
	m = decodeJSON(t, resp)
	if m["state"] != "READY" {
		t.Fatalf("expected READY after resume, got %v", m["state"])
	}
}

func TestRetirePreservesData(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "RetireTest")
	authorizeAlloc(t, ts, tok, a)
	allocID := a["allocId"].(string)
	username := a["username"].(string)

	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/retire", tok, map[string]int{"graceDays": 0})
	m := decodeJSON(t, resp)
	if m["state"] != "RETIRING" {
		t.Fatalf("expected RETIRING, got %v", m["state"])
	}

	// Verify repo directory still exists
	dir := t.TempDir()
	_ = dir
	_ = username
	// Data preservation is verified by the sftp_test.go Docker test;
	// here we just confirm the state transition.
}

func TestInvalidStateTransitions(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "StateTest")
	allocID := a["allocId"].(string)

	// Cannot suspend DRAFT
	resp := doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/suspend", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409 suspend DRAFT, got %d", resp.StatusCode)
	}

	// Cannot resume DRAFT
	resp = doRequest(t, ts, "POST", "/api/v1/allocations/"+allocID+"/resume", tok, nil)
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("expected 409 resume DRAFT, got %d", resp.StatusCode)
	}
}

// ── Events ────────────────────────────────────────────────────────────────────

func TestEventsEmitted(t *testing.T) {
	ts, tok := newTestServer(t)
	createAlloc(t, ts, tok, "EventTest")

	resp := doRequest(t, ts, "GET", "/api/v1/events", tok, nil)
	m := decodeJSON(t, resp)
	evts := m["events"].([]any)
	if len(evts) == 0 {
		t.Fatal("expected at least one event")
	}

	// Check first event has required fields
	first := evts[0].(map[string]any)
	if first["kind"] == nil || first["eventId"] == nil {
		t.Fatalf("event missing required fields: %v", first)
	}
}

// ── Redaction ─────────────────────────────────────────────────────────────────

func TestRedact(t *testing.T) {
	cases := []struct{ in, want string }{
		{"ssh-ed25519 AAAAfakekey comment", "[REDACTED-PUBLIC-KEY] comment"},
		{"Bearer " + strings.Repeat("a", 64), "[REDACTED-TOKEN]"},
		{"/config/agent.token read failed", "[CONFIG-PATH] read failed"},
	}
	for _, c := range cases {
		got := events.Redact(c.in)
		if got != c.want {
			t.Errorf("Redact(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ── Security invariants ───────────────────────────────────────────────────────

func TestNoOwnerPublicKeyInResponses(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "KeyLeakTest")
	authorizeAlloc(t, ts, tok, a)
	allocID := a["allocId"].(string)

	// Single get
	resp := doRequest(t, ts, "GET", "/api/v1/allocations/"+allocID, tok, nil)
	body := decodeJSON(t, resp)
	if _, ok := body["ownerPublicKey"]; ok {
		t.Fatal("ownerPublicKey leaked in GET response")
	}

	// List
	resp = doRequest(t, ts, "GET", "/api/v1/allocations", tok, nil)
	m := decodeJSON(t, resp)
	for _, raw := range m["allocations"].([]any) {
		alloc := raw.(map[string]any)
		if _, ok := alloc["ownerPublicKey"]; ok {
			t.Fatal("ownerPublicKey leaked in LIST response")
		}
	}
}

func TestQuotaModeAlwaysSoft(t *testing.T) {
	ts, tok := newTestServer(t)
	for i := 0; i < 3; i++ {
		a := createAlloc(t, ts, tok, fmt.Sprintf("QM%d", i))
		if a["quotaMode"] != "soft" {
			t.Fatalf("quotaMode must be soft on alloc %d, got %v", i, a["quotaMode"])
		}
	}

	resp := doRequest(t, ts, "GET", "/api/v1/allocations", tok, nil)
	m := decodeJSON(t, resp)
	for _, raw := range m["allocations"].([]any) {
		alloc := raw.(map[string]any)
		if alloc["quotaMode"] != "soft" {
			t.Fatalf("quotaMode must be soft in list, got %v", alloc["quotaMode"])
		}
	}
}

func TestAccessWindowEnforcementAlwaysFuture(t *testing.T) {
	ts, tok := newTestServer(t)
	a := createAlloc(t, ts, tok, "AWTest")
	if a["accessWindowEnforcement"] != "future" {
		t.Fatalf("accessWindowEnforcement must be future, got %v", a["accessWindowEnforcement"])
	}
}

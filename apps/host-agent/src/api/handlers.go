package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/bundle"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/health"
)

// ── Info / Status ─────────────────────────────────────────────────────────────

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"version": "0.1.0",
		"ready":   true,
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	allocs, _ := s.manager.List()
	readyCount := 0
	for _, a := range allocs {
		if a.State == "READY" {
			readyCount++
		}
	}
	total, avail := health.StorageStats(s.cfg.StorageRoot)
	writeJSON(w, http.StatusOK, map[string]any{
		"agentVersion":          "0.1.0",
		"startedAt":             s.startedAt,
		"configLoaded":          true,
		"allocationCount":       len(allocs),
		"readyCount":            readyCount,
		"storageRoot":           s.cfg.StorageRoot,
		"storageAvailableBytes": avail,
		"storageTotalBytes":     total,
	})
}

// ── Config ────────────────────────────────────────────────────────────────────

func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.cfg)
}

func (s *Server) handlePatchConfig(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body", "INTERNAL")
		return
	}
	var patch struct {
		HostLabel                      *string `json:"hostLabel"`
		AdvertisedCapacityBytes        *int64  `json:"advertisedCapacityBytes"`
		DefaultQuotaBytes              *int64  `json:"defaultQuotaBytes"`
		DefaultWarningThresholdPercent *int    `json:"defaultWarningThresholdPercent"`
		DefaultCriticalThresholdPercent *int   `json:"defaultCriticalThresholdPercent"`
		BandwidthCapBytesPerSecond     *int64  `json:"bandwidthCapBytesPerSecond"`
	}
	if err := json.Unmarshal(body, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON", "INTERNAL")
		return
	}
	if patch.HostLabel != nil {
		s.cfg.HostLabel = *patch.HostLabel
	}
	if patch.AdvertisedCapacityBytes != nil {
		s.cfg.AdvertisedCapacityBytes = *patch.AdvertisedCapacityBytes
	}
	if patch.DefaultQuotaBytes != nil {
		s.cfg.DefaultQuotaBytes = *patch.DefaultQuotaBytes
	}
	if patch.DefaultWarningThresholdPercent != nil {
		s.cfg.DefaultWarningThresholdPercent = *patch.DefaultWarningThresholdPercent
	}
	if patch.DefaultCriticalThresholdPercent != nil {
		s.cfg.DefaultCriticalThresholdPercent = *patch.DefaultCriticalThresholdPercent
	}
	if patch.BandwidthCapBytesPerSecond != nil {
		s.cfg.BandwidthCapBytesPerSecond = *patch.BandwidthCapBytesPerSecond
	}
	if err := s.cfgSave(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save config", "INTERNAL")
		return
	}
	writeJSON(w, http.StatusOK, s.cfg)
}

// ── Allocations ───────────────────────────────────────────────────────────────

func (s *Server) handleListAllocations(w http.ResponseWriter, r *http.Request) {
	allocs, err := s.manager.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	summaries := make([]allocation.Allocation, len(allocs))
	for i, a := range allocs {
		summaries[i] = a.Summary()
	}
	writeJSON(w, http.StatusOK, map[string]any{"allocations": summaries})
}

func (s *Server) handleCreateAllocation(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body", "INTERNAL")
		return
	}
	var req allocation.CreateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON", "INTERNAL")
		return
	}
	alloc, err := s.manager.Create(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	sum := alloc.Summary()
	writeJSON(w, http.StatusCreated, sum)
}

func (s *Server) handleGetAllocation(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	alloc, err := s.manager.Get(allocID)
	if err != nil {
		if err.Error() == "NOT_FOUND" {
			writeError(w, http.StatusNotFound, "allocation not found", "NOT_FOUND")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	sum := alloc.Summary()
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handlePatchAllocation(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body", "INTERNAL")
		return
	}
	var patch allocation.PatchRequest
	if err := json.Unmarshal(body, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON", "INTERNAL")
		return
	}
	alloc, err := s.manager.Update(allocID, patch)
	if err != nil {
		if err.Error() == "NOT_FOUND" {
			writeError(w, http.StatusNotFound, "allocation not found", "NOT_FOUND")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	sum := alloc.Summary()
	writeJSON(w, http.StatusOK, sum)
}

// ── Invite / Owner Response ───────────────────────────────────────────────────

func (s *Server) handleGenerateInvite(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	alloc, err := s.manager.Get(allocID)
	if err != nil {
		writeError(w, http.StatusNotFound, "allocation not found", "NOT_FOUND")
		return
	}
	if alloc.State != "DRAFT" && alloc.State != "EXPIRED" {
		writeError(w, http.StatusConflict, "allocation not in DRAFT or EXPIRED state", "INVALID_STATE")
		return
	}

	fp, _ := s.sftpMgr.GetHostKeyFingerprint()
	rsaFp, _ := s.sftpMgr.GetRSAHostKeyFingerprint()
	// Always refresh overlay before generating an invite so the bundle contains
	// the most current TAILSCALE_ADDRESS, even if it changed since startup.
	altFps := []string{}
	if rsaFp != "" && rsaFp != fp {
		altFps = append(altFps, rsaFp)
	}
	b := bundle.Generate(alloc, s.cfg, s.refreshOverlay(), fp, altFps...)

	now := time.Now().UTC()
	alloc.InviteExpiresAt = now.AddDate(0, 0, 90).Format(time.RFC3339)
	alloc.InviteExportedAt = now.Format(time.RFC3339)
	if err := s.manager.Transition(alloc, "PENDING_KEY"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	s.events.Append("invite.exported", allocID, "invite generated for "+alloc.ConnectionName)
	writeJSON(w, http.StatusOK, b)
}

func (s *Server) handleImportOwnerResponse(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	alloc, err := s.manager.Get(allocID)
	if err != nil {
		writeError(w, http.StatusNotFound, "allocation not found", "NOT_FOUND")
		return
	}
	if alloc.State != "PENDING_KEY" {
		writeError(w, http.StatusConflict, "allocation not in PENDING_KEY state", "INVALID_STATE")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body", "INTERNAL")
		return
	}

	resp, err := bundle.Parse(body, alloc)
	if err != nil {
		if pe, ok := err.(*bundle.ParseError); ok {
			switch pe.Code {
			case "INVITE_EXPIRED":
				writeError(w, http.StatusConflict, pe.Message, pe.Code)
			case "ALLOC_ID_MISMATCH", "MATCH_ID_MISMATCH":
				writeError(w, http.StatusConflict, pe.Message, pe.Code)
			default:
				writeError(w, http.StatusBadRequest, pe.Message, pe.Code)
			}
			return
		}
		writeError(w, http.StatusBadRequest, err.Error(), "INVALID_KEY")
		return
	}

	if err := s.sftpMgr.AuthorizeKey(alloc, resp.OwnerPublicKey); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "INVALID_KEY")
		return
	}

	alloc.OwnerPublicKey = resp.OwnerPublicKey
	alloc.OwnerDeviceLabel = resp.OwnerDeviceLabel
	alloc.OwnerKeyImportedAt = time.Now().UTC().Format(time.RFC3339)
	if err := s.manager.Transition(alloc, "READY"); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	s.events.Append("key.authorized", allocID, "owner key authorized for "+alloc.ConnectionName)

	sum := alloc.Summary()
	writeJSON(w, http.StatusOK, sum)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

func (s *Server) handleSuspend(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	alloc, err := s.lifecycle.Suspend(allocID)
	if err != nil {
		code, status := errorCode(err)
		writeError(w, status, err.Error(), code)
		return
	}
	sum := alloc.Summary()
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleResume(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	alloc, err := s.lifecycle.Resume(allocID)
	if err != nil {
		code, status := errorCode(err)
		writeError(w, status, err.Error(), code)
		return
	}
	sum := alloc.Summary()
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleRetire(w http.ResponseWriter, r *http.Request) {
	allocID := chi.URLParam(r, "allocId")
	body, _ := io.ReadAll(r.Body)
	var req struct {
		GraceDays *int `json:"graceDays"`
	}
	json.Unmarshal(body, &req)

	alloc, err := s.manager.Get(allocID)
	if err != nil {
		writeError(w, http.StatusNotFound, "allocation not found", "NOT_FOUND")
		return
	}
	graceDays := alloc.RetirementGraceDays
	if req.GraceDays != nil {
		graceDays = *req.GraceDays
	}

	retired, err := s.lifecycle.Retire(allocID, graceDays)
	if err != nil {
		code, status := errorCode(err)
		writeError(w, status, err.Error(), code)
		return
	}
	sum := retired.Summary()
	writeJSON(w, http.StatusOK, sum)
}

// ── Health / Overlay / SFTP Status / Storage ─────────────────────────────────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	report := health.Get(s.manager, s.sftpMgr, s.currentOverlay(), s.events,
		s.cfg.StorageRoot, s.sftpHost, s.sftpPort)
	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleOverlayStatus(w http.ResponseWriter, r *http.Request) {
	ov := s.currentOverlay()
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":              ov.Provider,
		"mode":                  ov.Mode,
		"available":             ov.Available,
		"hostAddress":           ov.HostAddress,
		"sftpExpectedHost":      ov.SFTPExpectedHost,
		"sftpPort":              ov.SFTPPort,
		"publicExposureWarning": ov.PublicExposureWarning,
	})
}

// handleRefreshOverlay re-reads TAILSCALE_ADDRESS from the process environment
// and updates the stored overlay status. Useful when the agent is run directly
// (not in Docker) and the environment changes at runtime. In Docker containers,
// env vars are fixed at container creation — use `docker compose up -d` to apply
// .env changes, which recreates the container with fresh env vars.
func (s *Server) handleRefreshOverlay(w http.ResponseWriter, r *http.Request) {
	ov := s.refreshOverlay()
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":              ov.Provider,
		"mode":                  ov.Mode,
		"available":             ov.Available,
		"hostAddress":           ov.HostAddress,
		"sftpExpectedHost":      ov.SFTPExpectedHost,
		"sftpPort":              ov.SFTPPort,
		"publicExposureWarning": ov.PublicExposureWarning,
	})
}

func (s *Server) handleSFTPStatus(w http.ResponseWriter, r *http.Request) {
	ov := s.currentOverlay()
	fp, _ := s.sftpMgr.GetHostKeyFingerprint()
	writeJSON(w, http.StatusOK, map[string]any{
		"running":                  s.sftpRunning(),
		"bindAddress":              s.sftpBind,
		"port":                     s.sftpPort,
		"publicExposureWarning":    ov.PublicExposureWarning,
		"hostKeyFingerprintSha256": fp,
		"activeUserCount":          s.sftpMgr.ActiveUserCount(),
	})
}

func (s *Server) handleStorageStatus(w http.ResponseWriter, r *http.Request) {
	allocs, _ := s.manager.List()
	total, avail := health.StorageStats(s.cfg.StorageRoot)
	writeJSON(w, http.StatusOK, map[string]any{
		"storageRoot":     s.cfg.StorageRoot,
		"totalBytes":      total,
		"availableBytes":  avail,
		"usedBytes":       total - avail,
		"allocationCount": len(allocs),
	})
}

func (s *Server) handleGetEvents(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > 200 {
				n = 200
			}
			limit = n
		}
	}
	var after time.Time
	if v := r.URL.Query().Get("after"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			after = t
		}
	}
	evts, err := s.events.Query(limit, after)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "INTERNAL")
		return
	}
	if evts == nil {
		evts = []events.EventRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": evts})
}

func errorCode(err error) (string, int) {
	switch err.Error() {
	case "NOT_FOUND":
		return "NOT_FOUND", http.StatusNotFound
	case "INVALID_STATE":
		return "INVALID_STATE", http.StatusConflict
	case "QUOTA_STILL_CRITICAL":
		return "QUOTA_STILL_CRITICAL", http.StatusConflict
	default:
		return "INTERNAL", http.StatusInternalServerError
	}
}

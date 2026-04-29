package api

import (
	"net"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/config"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/overlay"
	"github.com/nasbb/host-agent/src/sftp"
)

type Server struct {
	cfg           *config.Config
	cfgSave       func() error
	token         string
	events        *events.Logger
	manager       *allocation.Manager
	lifecycle     *allocation.Lifecycle
	sftpMgr       *sftp.Manager
	overlayStatus overlay.Status
	sftpBind      string
	sftpPort      int
	sftpHost      string
	startedAt     time.Time
}

type Options struct {
	Cfg           *config.Config
	CfgSave       func() error
	Token         string
	Events        *events.Logger
	Manager       *allocation.Manager
	Lifecycle     *allocation.Lifecycle
	SFTPMgr       *sftp.Manager
	OverlayStatus overlay.Status
	SFTPBind      string
	SFTPPort      int
	SFTPHost      string
}

func New(opts Options) *Server {
	return &Server{
		cfg:           opts.Cfg,
		cfgSave:       opts.CfgSave,
		token:         opts.Token,
		events:        opts.Events,
		manager:       opts.Manager,
		lifecycle:     opts.Lifecycle,
		sftpMgr:       opts.SFTPMgr,
		overlayStatus: opts.OverlayStatus,
		sftpBind:      opts.SFTPBind,
		sftpPort:      opts.SFTPPort,
		sftpHost:      opts.SFTPHost,
		startedAt:     time.Now().UTC(),
	}
}

func (s *Server) sftpRunning() bool {
	addr := net.JoinHostPort(s.sftpHost, health_intToStr(s.sftpPort))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func health_intToStr(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}

func (s *Server) Router() chi.Router {
	r := chi.NewRouter()

	r.Get("/api/v1/info", s.handleInfo)

	r.Group(func(r chi.Router) {
		r.Use(BearerAuth(s.token))

		r.Get("/api/v1/status", s.handleStatus)
		r.Get("/api/v1/config", s.handleGetConfig)
		r.Patch("/api/v1/config", s.handlePatchConfig)
		r.Get("/api/v1/health", s.handleHealth)
		r.Get("/api/v1/overlay/status", s.handleOverlayStatus)
		r.Get("/api/v1/sftp/status", s.handleSFTPStatus)
		r.Get("/api/v1/storage/status", s.handleStorageStatus)
		r.Get("/api/v1/events", s.handleGetEvents)

		r.Get("/api/v1/allocations", s.handleListAllocations)
		r.Post("/api/v1/allocations", s.handleCreateAllocation)
		r.Get("/api/v1/allocations/{allocId}", s.handleGetAllocation)
		r.Patch("/api/v1/allocations/{allocId}", s.handlePatchAllocation)
		r.Post("/api/v1/allocations/{allocId}/invite", s.handleGenerateInvite)
		r.Post("/api/v1/allocations/{allocId}/owner-response", s.handleImportOwnerResponse)
		r.Post("/api/v1/allocations/{allocId}/suspend", s.handleSuspend)
		r.Post("/api/v1/allocations/{allocId}/resume", s.handleResume)
		r.Post("/api/v1/allocations/{allocId}/retire", s.handleRetire)
	})

	return r
}

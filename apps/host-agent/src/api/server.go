package api

import (
	"net"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/config"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/overlay"
	"github.com/nasbb/host-agent/src/sftp"
)

type Server struct {
	cfg              *config.Config
	cfgSave          func() error
	token            string
	events           *events.Logger
	manager          *allocation.Manager
	lifecycle        *allocation.Lifecycle
	sftpMgr          *sftp.Manager
	overlayMu        sync.RWMutex
	overlayStatus    overlay.Status
	tailscaleAddrEnv string // value of TAILSCALE_ADDRESS at startup (re-read on refresh)
	sftpBind         string
	sftpPort         int
	sftpHost         string
	peerAPIPort      int
	startedAt        time.Time
}

type Options struct {
	Cfg              *config.Config
	CfgSave          func() error
	Token            string
	Events           *events.Logger
	Manager          *allocation.Manager
	Lifecycle        *allocation.Lifecycle
	SFTPMgr          *sftp.Manager
	OverlayStatus    overlay.Status
	TailscaleAddr    string
	SFTPBind         string
	SFTPPort         int
	SFTPHost         string
	PeerAPIPort      int
}

func New(opts Options) *Server {
	return &Server{
		cfg:              opts.Cfg,
		cfgSave:          opts.CfgSave,
		token:            opts.Token,
		events:           opts.Events,
		manager:          opts.Manager,
		lifecycle:        opts.Lifecycle,
		sftpMgr:          opts.SFTPMgr,
		overlayStatus:    opts.OverlayStatus,
		tailscaleAddrEnv: opts.TailscaleAddr,
		sftpBind:         opts.SFTPBind,
		sftpPort:         opts.SFTPPort,
		sftpHost:         opts.SFTPHost,
		peerAPIPort:      opts.PeerAPIPort,
		startedAt:        time.Now().UTC(),
	}
}

// currentOverlay returns the most recently computed overlay status under a read lock.
func (s *Server) currentOverlay() overlay.Status {
	s.overlayMu.RLock()
	defer s.overlayMu.RUnlock()
	return s.overlayStatus
}

// refreshOverlay re-reads TAILSCALE_ADDRESS from the process environment, recomputes
// overlay.Status, and stores it. In Docker containers the env var is fixed at container
// creation time; this is mainly useful when the container is recreated via
// `docker compose up -d` (which picks up .env changes) or for direct non-Docker runs.
func (s *Server) refreshOverlay() overlay.Status {
	freshAddr := os.Getenv("TAILSCALE_ADDRESS")
	newOv := overlay.GetStatus(freshAddr, s.sftpBind, s.sftpPort)
	s.overlayMu.Lock()
	s.overlayStatus = newOv
	s.overlayMu.Unlock()
	return newOv
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
		r.Post("/api/v1/overlay/refresh", s.handleRefreshOverlay)
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
		r.Delete("/api/v1/allocations/{allocId}", s.handleDeleteAllocation)
	})

	return r
}

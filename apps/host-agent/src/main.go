package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/nasbb/host-agent/src/allocation"
	"github.com/nasbb/host-agent/src/api"
	"github.com/nasbb/host-agent/src/config"
	"github.com/nasbb/host-agent/src/events"
	"github.com/nasbb/host-agent/src/overlay"
	"github.com/nasbb/host-agent/src/sftp"
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix

	configDir := getEnv("NASBB_CONFIG_DIR", "/config")
	stateDir := getEnv("NASBB_STATE_DIR", "/state")
	reposDir := getEnv("NASBB_REPOS_DIR", "/repos")
	logDir := getEnv("NASBB_LOG_DIR", "/logs")
	bindAddr := getEnv("NASBB_BIND_ADDR", "0.0.0.0:7420")
	tailscaleAddr := getEnv("TAILSCALE_ADDRESS", "")
	sftpBind := getEnv("NASBB_SFTP_BIND", "127.0.0.1")
	sftpPortStr := getEnv("NASBB_SFTP_PORT", "2222")
	sftpHost := getEnv("NASBB_SFTP_HOST", "127.0.0.1")

	sftpPort, _ := strconv.Atoi(sftpPortStr)
	if sftpPort == 0 {
		sftpPort = 2222
	}

	cfg, err := config.Load(configDir)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}
	cfg.SFTPPort = sftpPort
	cfg.SFTPBindAddress = sftpBind

	token, newly, err := config.LoadOrSetToken(configDir)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load token")
	}
	if newly {
		fmt.Printf(`
╔══════════════════════════════════════════════════════════╗
║  NASBB AGENT TOKEN                                       ║
║  %-56s║
║  Copy this into your desktop UI's agent settings.        ║
║  It will not be displayed again.                         ║
╚══════════════════════════════════════════════════════════╝
`, token)
	}

	evts := events.NewLogger(logDir)
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr}).With().Timestamp().Logger()

	log.Info().
		Str("configDir", configDir).
		Str("stateDir", stateDir).
		Str("reposDir", reposDir).
		Str("bindAddr", bindAddr).
		Str("sftpBind", sftpBind).
		Int("sftpPort", sftpPort).
		Msg("starting nasbb-agent")

	ov := overlay.GetStatus(tailscaleAddr, sftpBind, sftpPort)
	if ov.PublicExposureWarning {
		log.Warn().Msg("SECURITY WARNING: SFTP is bound to " + sftpBind +
			" without a configured TAILSCALE_ADDRESS. " +
			"Access is not restricted to a private overlay network. " +
			"Set TAILSCALE_ADDRESS or NASBB_SFTP_BIND=127.0.0.1 in your .env file.")
	}

	sftpMgr := sftp.NewManager(stateDir, reposDir)
	mgr := allocation.NewManager(configDir, stateDir, reposDir, evts, sftpMgr)
	quotaPoller := sftp.NewQuotaPoller(mgr, sftpMgr, reposDir, evts)
	lc := allocation.NewLifecycle(mgr, sftpMgr, quotaPoller, evts)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go quotaPoller.Start(ctx)
	lc.StartBackground(ctx)

	srv := api.New(api.Options{
		Cfg:           cfg,
		CfgSave:       func() error { return config.Save(cfg, configDir) },
		Token:         token,
		Events:        evts,
		Manager:       mgr,
		Lifecycle:     lc,
		SFTPMgr:       sftpMgr,
		OverlayStatus: ov,
		TailscaleAddr: tailscaleAddr,
		SFTPBind:      sftpBind,
		SFTPPort:      sftpPort,
		SFTPHost:      sftpHost,
	})

	log.Info().Str("addr", bindAddr).Msg("listening")
	if err := http.ListenAndServe(bindAddr, srv.Router()); err != nil {
		log.Fatal().Err(err).Msg("server error")
	}
}

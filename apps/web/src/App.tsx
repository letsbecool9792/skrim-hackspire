import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Download,
  ExternalLink,
  Eye,
  MousePointerClick,
  ScanText,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  SITE,
  HERO_ROWS,
  PIPELINE,
  METRICS,
  FOOTPRINT_ROWS,
  KNOWN_LIMITS,
  BUILD_STEPS,
  LICENCES,
} from "./content";

// ─── Icon map (only the icons we actually use) ─────────────────────────────────

const ICON_MAP = {
  Eye,
  ScanText,
  ShieldCheck,
  Brain,
  MousePointerClick,
} as const;

type IconName = keyof typeof ICON_MAP;

function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const Component = ICON_MAP[name];
  return <Component size={size} className={className} aria-hidden="true" />;
}

// ─── Token pill ────────────────────────────────────────────────────────────────

function Token({ label }: { label: string }) {
  return <span className="token">{label}</span>;
}

// ─── Hero visual ───────────────────────────────────────────────────────────────

function HeroVisual() {
  const [showRedacted, setShowRedacted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function cycle() {
      timerRef.current = setTimeout(() => {
        setShowRedacted((v) => !v);
        cycle();
      }, 2800);
    }
    cycle();
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="hero-visual" aria-label="Privacy demonstration">
      <div className="hero-panel-label" aria-live="polite">
        {showRedacted ? "What the server gets" : "What you see"}
      </div>
      <div className={`hero-panel${showRedacted ? " hero-panel--redacted" : ""}`}>
        <table className="hero-table" role="presentation">
          <tbody>
            {HERO_ROWS.map(({ label, value, tokenLabel }) => (
              <tr key={label}>
                <td className="hero-cell-label">{label}</td>
                <td className="hero-cell-value">
                  {showRedacted && tokenLabel !== null ? (
                    <Token label={tokenLabel} />
                  ) : (
                    <span>{value}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`section ${className}`}>
      <div className="container">{children}</div>
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="section-heading">{children}</h2>;
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <>
      {/* Skip link for keyboard users */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* ── Nav ── */}
      <header className="site-header" role="banner">
        <div className="container site-header-inner">
          <a href="/" className="site-brand" aria-label="Skrim home">
            <span className="brand-icon" aria-hidden="true">
              <ShieldCheck size={18} strokeWidth={2.25} />
            </span>
            Skrim
          </a>
          <nav aria-label="Page sections">
            <ul className="nav-list">
              <li><a href="#how-it-works" className="nav-link">How it works</a></li>
              <li><a href="#numbers" className="nav-link">Numbers</a></li>
              <li><a href="#try-it" className="nav-link">Try it</a></li>
              <li>
                <a
                  href={SITE.githubUrl}
                  className="nav-link nav-link--github"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub repository (opens in new tab)"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main-content">
        {/* ── 1. Hero ── */}
        <section id="hero" className="hero-section">
          <div className="container hero-inner">
            <div className="hero-copy">
              <h1 className="hero-title">{SITE.title}</h1>
              <p className="hero-tagline">{SITE.tagline}</p>
              <div className="hero-actions">
                <a
                  href={SITE.githubUrl}
                  className="btn btn--primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  View on GitHub
                </a>
                <a href="#how-it-works" className="btn btn--ghost">
                  How it works
                </a>
              </div>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* ── 2. The problem ── */}
        <Section id="the-problem" className="section--alt">
          <SectionHeading>The problem with every other AI agent</SectionHeading>
          <p className="section-body">
            Today's AI browser agents — Claude in Chrome, OpenAI's Operator, Copilot in Edge — work by shipping your
            screen to a company's server. That means your bank balance, your medical records, your inbox, and your face
            are sitting on somebody else's GPU, processed by a model you didn't choose, stored under policies you
            didn't read.
          </p>
          <p className="section-body">
            Skrim keeps all of that on your machine. The server gets a scrubbed, anonymised description of the
            screen — enough to reason about, not enough to identify you.
          </p>
        </Section>

        {/* ── 3. How it works ── */}
        <Section id="how-it-works">
          <SectionHeading>How it works</SectionHeading>
          <p className="section-body section-body--lead">
            Five stages. The first four happen entirely on your device. The server only ever sees stage four's output.
          </p>
          <ol className="pipeline" aria-label="Processing pipeline">
            {PIPELINE.map(({ icon, title, detail }, i) => (
              <li key={title} className="pipeline-step">
                <div className="pipeline-step-header">
                  <span className="pipeline-number" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="pipeline-icon" aria-hidden="true">
                    <Icon name={icon as IconName} size={18} />
                  </span>
                  <span className="pipeline-title">{title}</span>
                </div>
                <p className="pipeline-detail">{detail}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── 4. Why placeholders, not black boxes ── */}
        <Section id="why-placeholders" className="section--alt">
          <SectionHeading>Why placeholders, not black boxes</SectionHeading>
          <p className="section-body">
            Blacking out a field is simpler but it breaks the agent. If the server can't see an email field, it can't
            say "type the email there." The task fails.
          </p>
          <p className="section-body">
            Skrim uses <strong>referential redaction</strong>. Every private value becomes a typed token:
          </p>
          <div className="code-block" role="region" aria-label="Redaction example">
            <pre>
              <code>
                <span className="code-comment">{"// Real screen"}</span>{"\n"}
                {"Email: priya@example.com"}{"\n\n"}
                <span className="code-comment">{"// Sent to server"}</span>{"\n"}
                {"{ id: \"e17\", role: \"textbox\", label: \"Email\","}{"\n"}
                {"  value: \""}<Token label="PII:EMAIL:1" />{"\" }"}{"\n\n"}
                <span className="code-comment">{"// Server returns"}</span>{"\n"}
                {"{ action: \"fill\", target: \"e17\","}{"\n"}
                {"  value: \""}<Token label="PII:EMAIL:1" />{"\" }"}
              </code>
            </pre>
          </div>
          <p className="section-body">
            A lookup table in memory on your machine maps <Token label="PII:EMAIL:1" /> back to the real address.
            When the extension types it into the real field, that lookup happens locally, at typing time only. The
            real value never crosses the network.
          </p>
        </Section>

        {/* ── 5. Numbers ── */}
        <Section id="numbers">
          <SectionHeading>The numbers</SectionHeading>
          <p className="section-body section-body--lead">
            Measured on the actual dev machine (RTX 4050 Laptop, 6 GB VRAM, Chrome 152). Not assumed.
          </p>

          <div className="metrics-grid">
            {METRICS.map(({ value, label, detail }) => (
              <div key={label} className="metric-card">
                <div className="metric-value">{value}</div>
                <div className="metric-label">{label}</div>
                <p className="metric-detail">{detail}</p>
              </div>
            ))}
          </div>

          <h3 className="subsection-heading">On-device footprint breakdown</h3>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col" className="col-size">Size</th>
                </tr>
              </thead>
              <tbody>
                {FOOTPRINT_ROWS.map(({ asset, size }) => (
                  <tr key={asset}>
                    <td>{asset}</td>
                    <td className="col-size mono">{size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="section-note">
            Both WASM packages ship every build variant they support; shipping only the variants Chrome and Firefox
            actually load saves 63 MB versus including all variants.
          </p>
        </Section>

        {/* ── 6. Known limits ── */}
        <Section id="known-limits" className="section--alt">
          <SectionHeading>Known limits</SectionHeading>
          <p className="section-body">
            Teams that claim perfection get taken apart in questioning. Here is what Skrim doesn't do yet, or can't
            do by design.
          </p>
          <ul className="limits-list">
            {KNOWN_LIMITS.map((limit) => (
              <li key={limit} className="limit-item">
                {limit}
              </li>
            ))}
          </ul>
        </Section>

        {/* ── 7. Try it ── */}
        <Section id="try-it">
          <SectionHeading>Try it</SectionHeading>
          <p className="section-body">
            Skrim is not on the Chrome Web Store yet. Firefox is not supported yet. Chrome only for now.
          </p>

          {/* Download or Releases link */}
          <div className="download-row">
            {SITE.downloadUrl ? (
              <a
                href={SITE.downloadUrl}
                className="btn btn--primary btn--download"
                download
                aria-label="Download Skrim extension zip"
              >
                <Download size={18} aria-hidden="true" />
                Download for Chrome (.zip)
              </a>
            ) : (
              <a
                href={SITE.releasesUrl}
                className="btn btn--ghost"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} aria-hidden="true" />
                GitHub Releases
              </a>
            )}
            <span className="download-note">
              {SITE.downloadUrl
                ? "Download → unzip → chrome://extensions → Load unpacked"
                : "No release yet — build from source below, or watch releases for the first zip"}
            </span>
          </div>

          {/* Install after download */}
          {SITE.downloadUrl && (
            <div className="install-steps">
              <div className="install-step">
                <span className="install-num" aria-hidden="true">1</span>
                <span>Unzip the downloaded file.</span>
              </div>
              <div className="install-step">
                <span className="install-num" aria-hidden="true">2</span>
                <span>Open <code className="inline-code">chrome://extensions</code> in Chrome.</span>
              </div>
              <div className="install-step">
                <span className="install-num" aria-hidden="true">3</span>
                <span>Enable <strong>Developer mode</strong> (toggle, top-right).</span>
              </div>
              <div className="install-step">
                <span className="install-num" aria-hidden="true">4</span>
                <span>Click <strong>Load unpacked</strong> and select the unzipped folder.</span>
              </div>
              <div className="install-step">
                <span className="install-num" aria-hidden="true">5</span>
                <span>
                  Start the server: <code className="inline-code">pnpm dev:server</code> (requires a{" "}
                  <a href="https://console.groq.com" className="text-link" target="_blank" rel="noopener noreferrer">free Groq key</a>).
                </span>
              </div>
            </div>
          )}

          {/* Build from source (always shown as secondary path) */}
          <h3 className="subsection-heading">Build from source</h3>
          <div className="build-steps">
            {BUILD_STEPS.map(({ step, code }, i) => (
              <div key={step} className="build-step">
                <div className="build-step-header">
                  <span className="build-step-num" aria-hidden="true">{i + 1}</span>
                  <span className="build-step-label">{step}</span>
                </div>
                <div className="build-code-wrapper">
                  <Terminal size={14} className="build-code-icon" aria-hidden="true" />
                  <code className="build-code">{code}</code>
                </div>
              </div>
            ))}
          </div>
          <p className="section-note">
            You'll need a free{" "}
            <a
              href="https://console.groq.com"
              className="text-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Groq API key
            </a>{" "}
            (6,000 requests/day, no credit card). Alternatively, run Ollama locally with{" "}
            <code className="inline-code">ollama pull qwen3-vl:4b</code> for a fully offline setup.
          </p>
        </Section>
      </main>

      {/* ── Footer ── */}
      <footer className="site-footer" role="contentinfo">
        <div className="container footer-inner">
          <div className="footer-brand">
            <span className="brand-icon brand-icon--sm" aria-hidden="true">
              <ShieldCheck size={14} strokeWidth={2.25} />
            </span>
            <span className="footer-name">Skrim</span>
            <span className="footer-team">by {SITE.team}</span>
          </div>
          <div className="footer-licences">
            {LICENCES.map(({ name, notes }) => (
              <div key={name} className="footer-licence-row">
                <span className="footer-licence-name">{name}</span>
                <span className="footer-licence-notes">{notes}</span>
              </div>
            ))}
          </div>
          <div className="footer-links">
            <a
              href={SITE.githubUrl}
              className="footer-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} aria-hidden="true" />
              Source on GitHub
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

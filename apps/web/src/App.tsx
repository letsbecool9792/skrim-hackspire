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
  TRADEOFFS,
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

/**
 * The same page lines twice, side by side: what the user sees, and what the
 * server gets. Both at once, so the point lands without waiting for a swap.
 */
function HeroVisual() {
  return (
    <div className="hero-visual">
      <HeroPanel title="What you see" redacted={false} />
      <HeroPanel title="What the server gets" redacted />
    </div>
  );
}

function HeroPanel({ title, redacted }: { title: string; redacted: boolean }) {
  return (
    <figure className="hero-figure">
      <figcaption className="hero-panel-label">{title}</figcaption>
      <div className={`hero-panel${redacted ? " hero-panel--redacted" : ""}`}>
        <table className="hero-table">
          <tbody>
            {HERO_ROWS.map(({ label, value, tokenLabel }) => (
              <tr key={label}>
                <th scope="row" className="hero-cell-label">{label}</th>
                <td className="hero-cell-value">
                  {redacted && tokenLabel !== null ? <Token label={tokenLabel} /> : value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
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
          <a href={import.meta.env.BASE_URL} className="site-brand" aria-label="Skrim home">
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
                <a href="#try-it" className="btn btn--primary">
                  <Download size={16} aria-hidden="true" />
                  Get it for Chrome
                </a>
                <a href="#how-it-works" className="btn btn--ghost">
                  How it works
                </a>
                <a
                  href={SITE.githubUrl}
                  className="btn btn--ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} aria-hidden="true" />
                  Source
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
            Five stages. Four run on your device. The server only plans, from what stage three left of the page.
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
                {"{ type: \"type\", target: \"e17\","}{"\n"}
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
            Measured in a real Chromium with the extension loaded, on 37 pages we annotated by hand. Not assumed.
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
            The OmniParser icon detector (81 MB) is exported but not used yet, so releases leave it out.
          </p>
        </Section>

        {/* ── 5b. Tradeoffs ── */}
        <Section id="tradeoffs" className="section--alt">
          <SectionHeading>What we traded, and why</SectionHeading>
          <p className="section-body">
            Where a bigger or looser model buys something and costs something, we measured both sides
            on the same pages and picked. The highlighted row is what Skrim ships.
          </p>
          {TRADEOFFS.map(({ title, head, rows, note }) => (
            <div key={title}>
              <h3 className="subsection-heading">{title}</h3>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {head.map((h) => <th key={h} scope="col">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ cells, shipped }) => (
                      <tr key={cells[0]} className={shipped ? "row-shipped" : undefined}>
                        {cells.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="section-note">{note}</p>
            </div>
          ))}
          <p className="section-note">
            Method and every run:{" "}
            <a href={`${SITE.githubUrl}/blob/main/docs/tradeoffs.md`} className="text-link" target="_blank" rel="noopener noreferrer">
              docs/tradeoffs.md
            </a>
            .
          </p>
        </Section>

        {/* ── 6. Known limits ── */}
        <Section id="known-limits">
          <SectionHeading>Known limits</SectionHeading>
          <p className="section-body">
            What Skrim does not do yet, or cannot do by design, said plainly.
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
        <Section id="try-it" className="section--alt">
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
                  Open any page and click Skrim's toolbar button. It plans with our hosted server, which is on a
                  free tier shared by everyone trying it: a few steps a minute. To watch what the server receives,
                  open{" "}
                  <a href={SITE.dashboardUrl} className="text-link" target="_blank" rel="noopener noreferrer">
                    the live dashboard
                  </a>{" "}
                  in the same browser while the side panel is open.
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
            (no credit card). To plan on your own machine instead, install Ollama, run{" "}
            <code className="inline-code">ollama pull qwen3-vl:4b-instruct</code> and{" "}
            <code className="inline-code">pnpm ollama:setup</code>, then start the server with{" "}
            <code className="inline-code">MODEL_PROVIDER=ollama</code>.
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

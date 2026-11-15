import { useState } from "react";
import { ArrowRight, Download, ExternalLink, Terminal } from "lucide-react";
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
import { ThemeSwitch } from "./ThemeSwitch";

/*
 * The landing page as a redacted document ("Redline", design/tokens.css):
 * paper and ink, private values drawn as redaction bars with their
 * placeholder's name on them, and a red pen for the proof.
 */

/** Skrim's mark, "dot, dash": you, and the placeholder that goes in your place. */
function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="11" cy="24" r="7" fill="currentColor" />
      <rect x="22" y="18" width="23" height="12" rx="6" fill="var(--pen)" />
    </svg>
  );
}

function Token({ label }: { label: string }) {
  return <span className="token">{label}</span>;
}

function External({ href, children, className = "text-link" }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} className={className} target="_blank" rel="noopener noreferrer">{children}</a>;
}

/**
 * The hero's document: a page of someone's details. Flip it to see what the
 * planning server gets: the same page, each private value a placeholder.
 */
function HeroDocument() {
  const [serverView, setServerView] = useState(true);
  return (
    <figure className="doc-figure">
      <div className="doc-switch" role="group" aria-label="Whose view">
        <button type="button" aria-pressed={!serverView} onClick={() => setServerView(false)}>What you see</button>
        <button type="button" aria-pressed={serverView} onClick={() => setServerView(true)}>What the server gets</button>
      </div>
      <div className="doc">
        <div className="doc-head">
          <span className="doc-kind">Order confirmation</span>
          <span className="doc-ref">checkout · step 3 of 3</span>
        </div>
        <dl className="doc-rows">
          {HERO_ROWS.map(({ label, value, tokenLabel }) => (
            <div key={label} className="doc-row">
              <dt>{label}</dt>
              <dd>{serverView && tokenLabel !== null ? <Token label={tokenLabel} /> : value}</dd>
            </div>
          ))}
        </dl>
        <p className="doc-note">
          {serverView
            ? <>The planner reads this and answers <code>type <Token label="email 1" /> into e17</code>. Your device types the real address.</>
            : <>This is the page in your browser. None of the values marked as private leave it.</>}
        </p>
        <span className="stamp" aria-hidden="true">97 of 98 hidden</span>
      </div>
    </figure>
  );
}

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="section-head">
      <span className="kicker">{kicker}</span>
      <h2>{title}</h2>
      {children && <div className="section-lead">{children}</div>}
    </div>
  );
}

export default function App() {
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="site-header">
        <div className="container header-inner">
          <a href={import.meta.env.BASE_URL} className="brand" aria-label="Skrim home"><Mark />Skrim</a>
          <nav aria-label="Page sections">
            <ul className="nav">
              <li><a href="#how-it-works">How it works</a></li>
              <li><a href="#numbers">Numbers</a></li>
              <li><a href="#tradeoffs">Tradeoffs</a></li>
              <li><a href="#try-it">Try it</a></li>
              <li><External href={SITE.githubUrl} className="">GitHub</External></li>
            </ul>
          </nav>
          <ThemeSwitch />
        </div>
      </header>

      <main id="main-content">
        {/* ── Hero ── */}
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <span className="kicker">A browser agent · open source · open-weight models</span>
              <h1>
                Your agent gets the page. Your <span className="bar" aria-label="name">name</span> stays here.
              </h1>
              <p className="hero-lead">{SITE.tagline} Before anything leaves your browser, every personal detail is blacked out and given a placeholder. The real value is typed back only on your device.</p>
              <div className="hero-actions">
                <a href="#try-it" className="btn btn-ink"><Download size={16} aria-hidden="true" />Add to Chrome</a>
                <a href="#firefox" className="btn btn-line">Firefox and Android</a>
                <a href="#numbers" className="btn btn-pen">Read the numbers <ArrowRight size={16} aria-hidden="true" /></a>
              </div>
            </div>
            <HeroDocument />
          </div>
        </section>

        {/* ── The problem ── */}
        <section className="section" id="the-problem">
          <div className="container split">
            <SectionHead kicker="The problem" title="Every other AI agent ships your screen to a server." />
            <div className="prose">
              <p>
                Today's AI browser agents (Claude in Chrome, OpenAI's Operator, Copilot in Edge) work by sending what's
                on your screen to a company's server. Your bank balance, your inbox, your medical records and your face
                end up on somebody else's GPU, read by a model you didn't choose.
              </p>
              <p>
                Skrim keeps all of that on your machine. The server gets a description of the page with every private
                value swapped out: enough to plan the next click, not enough to know who you are.
              </p>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="section section-alt" id="how-it-works">
          <div className="container">
            <SectionHead kicker="How it works" title="Five stages. Four of them never leave your device.">
              The server only plans, from what stage three left of the page.
            </SectionHead>
            <ol className="stages">
              {PIPELINE.map(({ title, detail }, i) => {
                const onServer = /server/i.test(title);
                return (
                  <li key={title} className={`stage${onServer ? " stage-server" : ""}`}>
                    <span className="stage-num">{String(i + 1).padStart(2, "0")}</span>
                    <div className="stage-body">
                      <h3>{title}</h3>
                      <p>{detail}</p>
                    </div>
                    <span className="stage-where">{onServer ? "server" : "your device"}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* ── Why placeholders ── */}
        <section className="section" id="why-placeholders">
          <div className="container split">
            <SectionHead kicker="The trick" title="Placeholders, not black boxes." />
            <div className="prose">
              <p>
                Blacking out a field breaks the agent: if the server can't see the email field, it can't say "type the
                email there". So each private value becomes a placeholder with a name, and the server can still use it.
              </p>
              <pre className="code" aria-label="Redaction example"><code>
                <span className="code-c">{"// on your screen"}</span>{"\n"}
                {"Email: priya@example.com"}{"\n\n"}
                <span className="code-c">{"// what the server reads"}</span>{"\n"}
                {"[e17] textbox \"Email\" = "}<Token label="email 1" />{"\n\n"}
                <span className="code-c">{"// what the server answers"}</span>{"\n"}
                {"type "}<Token label="email 1" />{" into e17"}
              </code></pre>
              <p>
                A lookup table in your browser's memory maps <Token label="email 1" /> back to the real address. It's
                used at the moment of typing, on your device, and erased when the task ends.
              </p>
            </div>
          </div>
        </section>

        {/* ── Numbers ── */}
        <section className="section section-alt" id="numbers">
          <div className="container">
            <SectionHead kicker="The numbers" title="Measured, not assumed.">
              In a real Chromium with the extension loaded, on 37 pages we annotated by hand. We wrote the pages, so
              expect lower numbers on sites we didn't.
            </SectionHead>
            <div className="metrics">
              {METRICS.map(({ value, label, detail }) => (
                <div key={label} className="metric">
                  <span className="metric-value">{value}</span>
                  <span className="metric-label">{label}</span>
                  <p>{detail}</p>
                </div>
              ))}
            </div>
            <h3 className="table-title">What the extension carries</h3>
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th scope="col">On your device</th><th scope="col" className="num">Size</th></tr></thead>
                <tbody>
                  {FOOTPRINT_ROWS.map(({ asset, size }) => (
                    <tr key={asset}><td>{asset}</td><td className="num">{size}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ── Tradeoffs ── */}
        <section className="section" id="tradeoffs">
          <div className="container">
            <SectionHead kicker="Tradeoffs" title="What we traded, and why.">
              Where a bigger or looser model buys something and costs something, we measured both on the same pages
              and picked. The row marked <span className="shipped-tag">shipped</span> is what Skrim uses.
            </SectionHead>
            {TRADEOFFS.map(({ title, head, rows, note }) => (
              <div key={title} className="tradeoff">
                <h3 className="table-title">{title}</h3>
                <div className="table-wrap">
                  <table className="ledger">
                    <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map(({ cells, shipped }) => (
                        <tr key={cells[0]} className={shipped ? "row-shipped" : undefined}>
                          {cells.map((cell, i) => (i === 0
                            ? <th key={i} scope="row">{cell}{shipped && <span className="shipped-tag">shipped</span>}</th>
                            : <td key={i}>{cell}</td>))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note">{note}</p>
              </div>
            ))}
            <p className="note">
              Method and every run: <External href={`${SITE.githubUrl}/blob/main/docs/tradeoffs.md`}>docs/tradeoffs.md</External>.
            </p>
          </div>
        </section>

        {/* ── Known limits ── */}
        <section className="section section-alt" id="known-limits">
          <div className="container split">
            <SectionHead kicker="Known limits" title="What it doesn't do yet." />
            <ul className="limits">
              {KNOWN_LIMITS.map((limit) => <li key={limit}>{limit}</li>)}
            </ul>
          </div>
        </section>

        {/* ── Try it ── */}
        <section className="section" id="try-it">
          <div className="container">
            <SectionHead kicker="Try it" title="Load it yourself, in a minute.">
              Chrome, and Firefox on a computer or an Android phone. It's not in the add-on stores yet.
            </SectionHead>

            <div className="install">
              <div className="install-card">
                <h3>Chrome</h3>
                {SITE.downloadUrl
                  ? <a href={SITE.downloadUrl} className="btn btn-ink" download><Download size={16} aria-hidden="true" />Download for Chrome (.zip)</a>
                  : <External href={SITE.releasesUrl} className="btn btn-line">GitHub Releases</External>}
                <ol className="steps">
                  <li>Unzip the downloaded file.</li>
                  <li>Open <code>chrome://extensions</code>.</li>
                  <li>Turn on <strong>Developer mode</strong>, top right.</li>
                  <li>Click <strong>Load unpacked</strong> and pick the unzipped folder.</li>
                  <li>
                    Open any page and click Skrim's toolbar button. It plans with our hosted server, on a free tier
                    shared by everyone: a few steps a minute. To watch what the server receives, open{" "}
                    <External href={SITE.dashboardUrl}>the live dashboard</External> in the same browser.
                  </li>
                </ol>
              </div>
              <div className="install-card" id="firefox">
                <h3>Firefox, on a computer or Android</h3>
                <a href={SITE.firefoxUrl} className="btn btn-line" download><Download size={16} aria-hidden="true" />Download for Firefox (.zip)</a>
                <ol className="steps">
                  <li>Open <code>about:debugging</code> → This Firefox.</li>
                  <li>Click <strong>Load Temporary Add-on</strong> and pick the zip. It lasts until Firefox closes.</li>
                  <li>
                    On Android, Firefox has no sidebar, so Skrim opens as a tab that works on the tab you opened it
                    from. Installing it there takes a Mozilla-signed build or a USB cable:{" "}
                    <External href={SITE.phonesUrl}>how Skrim runs on a phone</External>.
                  </li>
                </ol>
              </div>
            </div>

            <h3 className="table-title">Build from source</h3>
            <ol className="build">
              {BUILD_STEPS.map(({ step, code }) => (
                <li key={step}>
                  <span className="build-label">{step}</span>
                  <code className="build-code"><Terminal size={13} aria-hidden="true" />{code}</code>
                </li>
              ))}
            </ol>
            <p className="note">
              You'll need a free <External href="https://console.groq.com">Groq API key</External> (no card). To plan on
              your own machine instead, install Ollama, run <code>ollama pull qwen3-vl:4b-instruct</code> and{" "}
              <code>pnpm ollama:setup</code>, then start the server with <code>MODEL_PROVIDER=ollama</code>.
            </p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <span className="brand"><Mark size={20} />Skrim</span>
            <span className="footer-team">by team {SITE.team}</span>
            <div className="footer-links">
              <External href={SITE.githubUrl}><ExternalLink size={13} aria-hidden="true" /> Source</External>
              <External href={SITE.devfolioUrl}><ExternalLink size={13} aria-hidden="true" /> Devfolio</External>
              <External href={SITE.dashboardUrl}><ExternalLink size={13} aria-hidden="true" /> Live dashboard</External>
            </div>
          </div>
          <dl className="licences">
            {LICENCES.map(({ name, notes }) => (
              <div key={name}><dt>{name}</dt><dd>{notes}</dd></div>
            ))}
          </dl>
        </div>
      </footer>
    </>
  );
}

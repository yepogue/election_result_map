import { SiteFooter, SiteHeader } from "../components/SiteNavigation";
import LegacyMapLinks from "../components/LegacyMapLinks";
import election from "../../public/data/election.json";
import factors from "../../public/data/precinct_factor_analysis.json";

const number = (value: number) => value.toLocaleString("en-US");

export default function OverviewPage() {
  const totalVotes = election.brownsberger_votes + election.lander_votes;
  const registered = factors.observations.reduce((sum, row) => sum + row.registeredVoters, 0);
  const ballots = factors.observations.reduce((sum, row) => sum + Math.round(row.turnoutPct * row.registeredVoters / 100), 0);
  const belmontMargin = factors.observations.filter(row => row.municipality === "Belmont").reduce((sum, row) => sum + Math.round((2 * row.brownsbergerSharePct / 100 - 1) * row.twoCandidateVotes), 0);
  return <main className="landing-page" id="top">
    <LegacyMapLinks />
    <SiteHeader active="overview" />
    <section className="landing-hero" id="main-content" tabIndex={-1}>
      <p className="kicker">September 1, 2026 · Massachusetts Democratic primary</p>
      <h1>A close result.<br />A divided district.</h1>
      <p className="landing-deck">Brownsberger won the Suffolk &amp; Middlesex Senate primary by <strong>{number(election.margin)} votes</strong> after the recount.</p>
      <div className="landing-result" aria-label="Certified recount result">
        <div><span>William Brownsberger</span><strong>{number(election.brownsberger_votes)}</strong><b>{(100 * election.brownsberger_votes / totalVotes).toFixed(2)}%</b></div>
        <div><span>Daniel Lander</span><strong>{number(election.lander_votes)}</strong><b>{(100 * election.lander_votes / totalVotes).toFixed(2)}%</b></div>
      </div>
      <p className="landing-source">Shares of Brownsberger + Lander votes, excluding blanks and other votes. <a href="/election-map#sources">Certified recount · completed {election.recount_completed} ↗</a></p>
      <div className="landing-geography"><h2>Where the margin came from</h2><p>Brownsberger’s <strong>{number(belmontMargin)}-vote lead in Belmont</strong> offset Lander’s combined <strong>{number(belmontMargin - election.margin)}-vote lead</strong> in Boston, Cambridge, and Watertown.</p></div>
      <div className="landing-context"><span><b>{factors.precinctCount}</b> precincts · 4 municipalities</span><span><b>{(100 * ballots / registered).toFixed(1)}%</b> overall primary turnout</span><small>Turnout counts all parties’ primary ballots, not just this Senate race.</small></div>
    </section>
    <section className="landing-analyses" aria-labelledby="explore-heading">
      <h2 id="explore-heading">Explore the evidence</h2>
      <p>Four views, each answering a different question.</p>
      <div className="landing-cards">
        <article><p className="eyebrow">01 · THE RESULT</p><h3>Where did each candidate win?</h3><p>Explore votes, turnout, and estimated community characteristics on the precinct map.</p><span>All 59 district precincts · sortable data &amp; sources</span><a href="/election-map">Election map <b aria-hidden="true">→</b></a></article>
        <article><p className="eyebrow">02 · HISTORICAL ALIGNMENT</p><h3>Did Wu’s strongholds favor the challengers?</h3><p>All three challengers generally did better in Wu-stronger precincts—including Yu, whom Wu did not endorse.</p><span>Boston only · three Senate races &amp; three Wu elections</span><a href="/wu-precinct-analysis">Wu comparisons <b aria-hidden="true">→</b></a></article>
        <article><p className="eyebrow">03 · COMMUNITY PATTERNS</p><h3>How did support and turnout vary?</h3><p>More renter-heavy precincts tended to give Brownsberger less support; younger precincts tended to have lower turnout, even accounting for municipality.</p><span>All 59 district precincts · estimated Census context</span><a href="/precinct-factor-analysis">Community factors <b aria-hidden="true">→</b></a></article>
        <article><p className="eyebrow">04 · A CLOSER LOOK</p><h3>Is the renter pattern just geography?</h3><p>See whether renter-heavy precincts gave Brownsberger less support even within the same city or town, and how that comparison works.</p><span>All 59 district precincts · renter-share summaries by city/town</span><a href="/renters-voting">Renters &amp; voting <b aria-hidden="true">→</b></a></article>
      </div>
      <p className="landing-caution">These analyses compare places, not individual voters. They show associations—not the causes of the result or the effect of an endorsement.</p>
    </section>
    <SiteFooter />
  </main>;
}

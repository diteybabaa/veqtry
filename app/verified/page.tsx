export default function VerifiedPage() {
  return (
    <main className="stage">
      <div className="stage__bg" aria-hidden="true" />
      <div className="stage__veil" aria-hidden="true" />
      <section className="card" style={{ textAlign: "center" }}>
        <h1 className="card__title">Verification complete</h1>
        <p className="card__desc" style={{ margin: "0 auto" }}>
          You can continue to the site.
        </p>
        <a
          href="/"
          className="card__legal"
          style={{ display: "inline-block", color: "#3367d6", fontSize: 12 }}
        >
          Start over
        </a>
      </section>
    </main>
  );
}

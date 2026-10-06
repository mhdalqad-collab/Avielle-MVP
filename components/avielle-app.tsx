"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  HeartHandshake,
  Leaf,
  Menu,
  MoveUpRight,
  Shirt,
  X,
} from "lucide-react";
import { api, AuthProvider, errorMessage, Notice, useAuth } from "./shared";
import { ExplorePage, ItemPage } from "./catalogue";
import { AuthPage } from "./auth-pages";
import { DashboardPage } from "./dashboard";
import { ListingPage } from "./listing-form";
import { BookingPage } from "./booking";
import { ProfilePage, MemberPage } from "./profile";

export function AvielleApp() {
  return (
    <AuthProvider>
      <Site />
    </AuthProvider>
  );
}
function Site() {
  const path = usePathname();
  let page: React.ReactNode;
  if (path === "/") page = <HomePage />;
  else if (path === "/explore") page = <ExplorePage />;
  else if (/^\/items\/[^/]+$/.test(path))
    page = <ItemPage key={path} id={path.split("/")[2]} />;
  else if (
    [
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
    ].includes(path)
  )
    page = <AuthPage key={path} path={path} />;
  else if (path === "/profile") page = <ProfilePage />;
  else if (/^\/members\/[^/]+$/.test(path))
    page = <MemberPage key={path} id={path.split("/")[2]} />;
  else if (path === "/dashboard") page = <DashboardPage />;
  else if (path === "/list") page = <ListingPage />;
  else if (/^\/bookings\/[^/]+$/.test(path))
    page = <BookingPage key={path} id={path.split("/")[2]} />;
  else if (path === "/how-it-works") page = <HowItWorksPage />;
  else if (path === "/terms" || path === "/privacy")
    page = <PolicyPage privacy={path === "/privacy"} />;
  else
    page = (
      <div className="page narrow center">
        <p className="eyebrow">A little off the rack</p>
        <h1>We couldn’t find that page.</h1>
        <p>Discover the wardrobe, or head back to somewhere familiar.</p>
        <Link href="/explore" className="button">
          Explore the wardrobe <ArrowRight size={17} />
        </Link>
      </div>
    );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">{page}</main>
      <Footer />
    </>
  );
}
function Header() {
  const auth = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  return (
    <>
      <div className="announcement">
        Less owning. More possibilities. <span>A wardrobe worth sharing.</span>
      </div>
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="Avielle home">
          avielle
        </Link>
        <nav aria-label="Main navigation" className="desktop-nav">
          <Link
            href="/explore"
            aria-current={path === "/explore" ? "page" : undefined}
          >
            Explore the wardrobe
          </Link>
          <Link
            href="/how-it-works"
            aria-current={path === "/how-it-works" ? "page" : undefined}
          >
            How it works
          </Link>
        </nav>
        <div className="header-actions">
          {auth.user ? (
            <Link href="/dashboard" className="account-link">
              <span className="avatar">{auth.user.name.charAt(0)}</span>
              <span>My wardrobe</span>
            </Link>
          ) : (
            <Link href="/login" className="signin-link">
              Sign in
            </Link>
          )}
          <Link href="/list" className="button header-list">
            List a piece <ArrowUpRight size={16} />
          </Link>
          <button
            className="menu-toggle"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav
            id="mobile-menu"
            className="mobile-nav"
            aria-label="Mobile navigation"
          >
            <Link href="/explore">Explore the wardrobe</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/list">List a piece</Link>
            <Link href={auth.user ? "/dashboard" : "/login"}>
              {auth.user ? "My wardrobe" : "Sign in"}
            </Link>
          </nav>
        )}
      </header>
      {auth.user && path === "/dashboard" && (
        <div className="account-strip">
          <span>
            Signed in as {auth.user.name} ·{" "}
            <Link className="underline" href="/profile">
              My profile
            </Link>
          </span>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/api/auth", { action: "logout" });
                await auth.refresh();
                router.push("/");
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
      {error && (
        <div className="page compact">
          <Notice>{error}</Notice>
        </div>
      )}
    </>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div>
          <Link href="/" className="wordmark">
            avielle
          </Link>
          <p>
            A little less in your wardrobe.
            <br />A little more in your world.
          </p>
        </div>
        <div className="footer-links">
          <Link href="/explore">
            Find your next piece <ArrowUpRight size={15} />
          </Link>
          <Link href="/list">
            Share your wardrobe <ArrowUpRight size={15} />
          </Link>
          <Link href="/how-it-works">
            How it works <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Avielle</span>
        <span className="footer-policies">
          <Link href="/terms">Rental terms</Link>
          <Link href="/privacy">Privacy</Link>
        </span>
        <span>Wear. Share. Repeat.</span>
      </div>
    </footer>
  );
}

function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-line" /> THE SHARED WARDROBE
          </p>
          <h1>
            Great style.
            <br />A lighter
            <br />
            <em>footprint.</em>
          </h1>
          <p className="hero-description">
            Fall in love with what you wear.
            <br />
            Rent beautiful pieces. Share the ones you love.
            <br />
            Make room for more possibilities.
          </p>
          <div className="button-row">
            <Link href="/explore" className="button">
              Explore the wardrobe <ArrowRight size={18} />
            </Link>
            <Link href="/list" className="text-link">
              Start lending <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className="hero-note">
            <Leaf size={17} strokeWidth={1.5} />
            <span>A new way to wear what you love.</span>
          </div>
        </div>
        <div className="hero-image">
          <img
            src="/images/hero.jpg"
            alt="Editorial portrait of a woman wearing an ivory tailored suit"
            fetchPriority="high"
          />
          <div className="hero-image-caption">
            <span>
              STYLE IS YOURS.
              <br />
              OWNERSHIP IS OPTIONAL.
            </span>
            <span className="caption-circle">
              <MoveUpRight size={25} strokeWidth={1.2} />
            </span>
          </div>
          <span className="image-credit">
            Editorial inspiration · not a rental listing
          </span>
        </div>
      </section>
      <div className="brand-values">
        <span>
          <Shirt size={18} strokeWidth={1.4} /> Pieces with another story to
          tell
        </span>
        <span>
          <HeartHandshake size={19} strokeWidth={1.4} /> From one wardrobe to
          another
        </span>
        <span>
          <Leaf size={18} strokeWidth={1.4} /> Thoughtfully worn, again and
          again
        </span>
      </div>
      <section className="section home-intro">
        <div>
          <p className="eyebrow">ALL THE OCCASIONS. LESS OF THE EXCESS.</p>
          <h2>
            A wardrobe that
            <br />
            <em>opens doors.</em>
          </h2>
        </div>
        <div>
          <p>
            For the invitation you can’t turn down. The weekend you’ve been
            waiting for. Or simply a different kind of Tuesday.
          </p>
          <p>
            Avielle connects people with pieces worth sharing. Find something
            that feels like you, arrange a local pickup, and return it ready for
            its next chapter.
          </p>
          <Link href="/explore" className="text-link underline">
            Find your next piece <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
      <section className="section steps-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">GOOD STYLE. SIMPLE STEPS.</p>
            <h2>Yours, for the moment.</h2>
          </div>
          <Link href="/how-it-works" className="text-link">
            The finer details <ArrowRight size={17} />
          </Link>
        </div>
        <div className="steps-grid">
          {[
            {
              n: "01",
              title: "Find your piece",
              copy: "Discover real listings, compare the details, and choose the dates that fit your plans.",
            },
            {
              n: "02",
              title: "Make it happen",
              copy: "Send a request. Once the lender accepts, pay securely and arrange a local pickup together.",
            },
            {
              n: "03",
              title: "Wear. Return. Repeat.",
              copy: "Capture its condition, enjoy your piece, then return it for inspection and deposit settlement.",
            },
          ].map((step) => (
            <article key={step.n}>
              <span className="step-number">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lender-banner">
        <div className="banner-monogram" aria-hidden="true">
          a
        </div>
        <div>
          <p className="eyebrow">YOUR WARDROBE HAS POTENTIAL</p>
          <h2>
            Let your favourites
            <br />
            be someone’s <em>first choice.</em>
          </h2>
          <p>
            Give the pieces you love more moments to shine.
            <br />
            List your first piece and be part of the Avielle community.
          </p>
          <Link href="/list" className="button light">
            Open your wardrobe <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
      <section className="section faq-section">
        <div>
          <p className="eyebrow">A FEW THINGS TO KNOW</p>
          <h2>
            Consider this
            <br />
            your fitting room.
          </h2>
          <p>A little clarity before your first rental.</p>
        </div>
        <div className="faq-list">
          {[
            {
              q: "Can I rent and lend with the same account?",
              a: "Yes. One account gives you a place to discover pieces, list your own wardrobe, manage requests and talk with other members.",
            },
            {
              q: "How do I collect a piece?",
              a: "Our first rentals use local pickup. Check the listing’s area before requesting, then agree a time and place with the lender through your booking conversation.",
            },
            {
              q: "How does the deposit work?",
              a: "The deposit is charged with your rental payment. It is refundable after the piece has been returned and inspected, subject to any damage claim. Your booking shows the full price before checkout.",
            },
            {
              q: "Can I cancel a booking?",
              a: "You can cancel before handover. If you have already paid and the piece has not been handed over, cancellation starts a full refund. Your bank determines when refunded funds appear. See the rental terms for the complete pilot policy.",
            },
          ].map((faq) => (
            <details key={faq.q}>
              <summary>
                {faq.q}
                <ChevronDown size={18} />
              </summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
function HowItWorksPage() {
  return (
    <div className="page">
      <div className="page-heading centered">
        <p className="eyebrow">A LITTLE SHARING GOES A LONG WAY</p>
        <h1>
          Beautiful pieces.
          <br />
          <em>Clear expectations.</em>
        </h1>
        <p>Everything you need to make your first rental feel familiar.</p>
      </div>
      <div className="two-columns">
        <section className="panel">
          <p className="eyebrow">FOR RENTERS</p>
          <h2>Find your next moment.</h2>
          <ol className="numbered-list">
            <li>
              <strong>Choose thoughtfully.</strong>
              <p>
                Read the measurements, condition and pickup area. Choose
                available dates and send the lender a request.
              </p>
            </li>
            <li>
              <strong>Confirm and pay.</strong>
              <p>
                The lender has 48 hours to respond. Once approved, pay within 24
                hours. Checkout shows the rental, cleaning, service fee and
                refundable deposit.
              </p>
            </li>
            <li>
              <strong>Collect locally.</strong>
              <p>
                Use your booking conversation to agree pickup. Compare the piece
                to its condition photos and record your own photos before
                wearing.
              </p>
            </li>
            <li>
              <strong>Return with care.</strong>
              <p>
                Upload return photos, then mark it returned after giving the
                piece back. The lender inspects it before the deposit is
                settled.
              </p>
            </li>
          </ol>
          <Link href="/explore" className="button">
            Explore the wardrobe <ArrowRight size={17} />
          </Link>
        </section>
        <section className="panel cream">
          <p className="eyebrow">FOR LENDERS</p>
          <h2>Share what you love.</h2>
          <ol className="numbered-list">
            <li>
              <strong>Make a considered listing.</strong>
              <p>
                Upload your own photos, describe condition and fit, set your
                daily price, deposit, cleaning fee and availability. Listings
                are reviewed before publication.
              </p>
            </li>
            <li>
              <strong>Get ready to get paid.</strong>
              <p>
                Verify your email and complete Stripe onboarding. A renter can
                pay only once your payout account is ready.
              </p>
            </li>
            <li>
              <strong>Keep a clear record.</strong>
              <p>
                Accept suitable requests. At pickup, photograph the condition
                and mark the paid booking as handed over when the rental starts.
              </p>
            </li>
            <li>
              <strong>Close the loop.</strong>
              <p>
                Inspect the returned piece and add return photos. Complete the
                rental to trigger the deposit refund and your earnings, or raise
                a documented claim.
              </p>
            </li>
          </ol>
          <Link href="/list" className="button">
            List your first piece <ArrowRight size={17} />
          </Link>
        </section>
      </div>
      <div className="policy-callout">
        <Check size={24} />
        <div>
          <h3>No surprises at checkout.</h3>
          <p>
            Prices and fees are shown before you pay. Deposits are charged, then
            refunded after return subject to any resolved claim. Rentals use
            local pickup. Insurance and delivery are not included.
          </p>
          <Link className="text-link underline" href="/terms">
            Read rental terms <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </div>
  );
}
function PolicyPage({ privacy }: { privacy: boolean }) {
  return (
    <div className="page prose">
      <p className="eyebrow">AVIELLE · PILOT COMMUNITY</p>
      <h1>{privacy ? "Your privacy" : "Rental terms"}</h1>
      <p className="lead">
        {privacy
          ? "A clear view of the information used to run your account and rentals."
          : "Please read these conditions before requesting, lending or paying for a piece."}
      </p>
      {privacy ? (
        <>
          <h2>Information you provide</h2>
          <p>
            Avielle stores the name and email used for your account, a password
            hash, email verification and account recovery records. We also store
            your listings, uploaded photos, booking details, messages, condition
            evidence, claims and reviews.
          </p>
          <h2>How information is used</h2>
          <p>
            This information supports account access, listing moderation, rental
            requests, payment records, communication, returns and dispute
            handling. Account and upload records help protect the service
            against misuse.
          </p>
          <h2>Who can see it</h2>
          <p>
            Published listings and the lender’s display name are public. Booking
            conversations and condition evidence are accessible to the booking
            participants and authorised administrators. Your account email is
            not displayed in the public catalogue. Do not include contact
            details or sensitive information in public listing photos or
            descriptions.
          </p>
          <h2>Payments and service providers</h2>
          <p>
            Stripe processes checkout and lender onboarding. Avielle stores
            payment identifiers and status, not your complete payment card
            details. Hosting, database, email and file storage providers process
            information as part of delivering the service.
          </p>
          <h2>Cookies and account access</h2>
          <p>
            An essential session cookie keeps you signed in. Signing out ends
            the session. Avielle’s MVP does not include advertising trackers or
            marketing cookies.
          </p>
          <h2>Your information</h2>
          <p>
            You can pause your own listings in My wardrobe. For access,
            correction, deletion or a privacy concern, contact the Avielle
            operator through the support contact supplied with your pilot
            invitation. Some booking and payment records may need to be retained
            for operational or legal reasons.
          </p>
        </>
      ) : (
        <>
          <h2>The rental arrangement</h2>
          <p>
            Avielle connects lenders and renters. You must provide accurate
            account and listing details, be able to enter the rental
            arrangement, and have the right to lend any piece you list. A single
            account may rent and lend.
          </p>
          <h2>Listing details and availability</h2>
          <p>
            Lenders must use their own accurate photographs and describe wear,
            defects, measurements, fees and location clearly. A listing review
            is not a guarantee of authenticity, condition or suitability.
            Renters should review these details and ask questions before
            proceeding.
          </p>
          <h2>Requests and payment</h2>
          <p>
            Requests expire after 48 hours without approval. Approved requests
            must be paid within 24 hours. Start checkout at least 31 minutes
            before the approval deadline. A checkout session lasts 31 minutes;
            reopening or retrying it does not extend its deadline. The exact
            deadline is shown in your booking. A booking is paid only when the
            payment provider confirms it. Follow the current status in your
            booking.
          </p>
          <h2>Rental price and fees</h2>
          <p>
            The rental is charged for every selected calendar date, including
            pickup and return dates. Your quote separately shows any cleaning
            fee, the renter service fee and the refundable deposit. Lenders can
            see the platform commission and their earnings before accepting.
            Rates are configured by the operator and included in the quote.
          </p>
          <h2>The refundable deposit</h2>
          <p>
            The deposit is charged as part of the total payment. It is not a
            long card authorisation. It is returned after the lender records an
            inspected return, subject to any documented and resolved damage
            claim. Provider and bank processing times affect when refunds
            arrive.
          </p>
          <h2>Pickup, care and return</h2>
          <p>
            The pilot uses local pickup only. Arrange the details in the booking
            conversation. Record clear condition photos before handover and
            after return. The lender records handover only after payment and on
            or after the start date. Return the piece by the agreed end date and
            follow the lender’s care instructions. No delivery or insurance
            cover is included.
          </p>
          <h2>Cancellations</h2>
          <p>
            Either participant may cancel before handover. If payment has
            already been confirmed, cancellation before handover triggers a full
            refund of the recorded payment. Do not hand over an item while
            cancellation or payment reconciliation is pending. After handover,
            use the return and claim process; automatic cancellation refunds are
            unavailable.
          </p>
          <h2>Damage claims and settlement</h2>
          <p>
            A claim needs a description, requested amount and condition
            evidence. An open claim pauses settlement. An administrator reviews
            the evidence and records a resolution; any deposit deduction is
            limited to the deposit and the requested amount. The remaining
            deposit is refunded and lender earnings are transferred through the
            payment provider after settlement. Failed financial operations
            remain pending for retry and review.
          </p>
          <h2>Overdue or missing pieces</h2>
          <p>
            If a piece is not returned after the booked end date, the lender may
            open a non-return claim with their original handover evidence.
            Operations reviews it before settlement, and any award is limited to
            the deposit and requested amount. A missing piece is paused from the
            wardrobe. Further recovery beyond the deposit requires separate
            support and is not an automatic charge.
          </p>
          <h2>Reviews and support</h2>
          <p>
            Participants can leave a review after a completed rental. Keep
            messages, photos and reviews relevant and respectful. For help with
            a booking, contact the Avielle operator using the support details in
            your pilot invitation and include your booking reference.
          </p>
        </>
      )}
      <div className="policy-callout">
        <p>
          These pages describe the pilot’s current product rules. Your pilot
          invitation identifies the operator and support contact. Keep a copy of
          your booking details and agreed pickup arrangements.
        </p>
      </div>
    </div>
  );
}

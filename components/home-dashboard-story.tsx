"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Heart,
  Leaf,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const chapters = ["Discover", "Wear", "Share"];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A labelled interface illustration, with no fictional account or rental data. */
export function HomeDashboardStory() {
  const story = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const wake = useRef<() => void>(() => {});
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [chapter, setChapter] = useState(0);

  useEffect(() => {
    pausedRef.current = paused;
    wake.current();
  }, [paused]);

  useEffect(() => {
    const element = story.current!;
    const frame = stage.current!;
    const scene = element.querySelector<HTMLElement>(".home-dashboard-scene")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let visible = true;
    let disposed = false;
    let animationFrame = 0;
    let lastDraw = 0;
    let progress = 0;
    let targetProgress = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;

    function paint() {
      element.dataset.motionProgress = progress.toFixed(3);
      scene.style.setProperty("--story-progress", progress.toFixed(4));
      scene.style.setProperty("--pointer-x", x.toFixed(4));
      scene.style.setProperty("--pointer-y", y.toFixed(4));
    }
    function active() {
      const enabled =
        visible && !document.hidden && !pausedRef.current && !motion.matches;
      element.dataset.motionActive = String(enabled);
      return enabled;
    }
    function animate(now: number) {
      animationFrame = 0;
      if (disposed || !active()) return;
      if (now - lastDraw >= 1000 / 30) {
        progress += (targetProgress - progress) * 0.22;
        x += (targetX - x) * 0.18;
        y += (targetY - y) * 0.18;
        if (Math.abs(targetProgress - progress) < 0.001)
          progress = targetProgress;
        if (Math.abs(targetX - x) < 0.001) x = targetX;
        if (Math.abs(targetY - y) < 0.001) y = targetY;
        paint();
        lastDraw = now;
      }
      // No idle JavaScript loop: schedule only until the latest input settles.
      if (progress !== targetProgress || x !== targetX || y !== targetY)
        animationFrame = requestAnimationFrame(animate);
    }
    function resume() {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (disposed) return;
      if (motion.matches) {
        progress = x = y = 0;
        paint();
      }
      if (active()) animationFrame = requestAnimationFrame(animate);
    }
    wake.current = resume;
    function measure() {
      const bounds = element.getBoundingClientRect();
      const pinned = getComputedStyle(frame).position === "sticky";
      const travel = Math.max(
        1,
        pinned ? bounds.height - frame.clientHeight : bounds.height,
      );
      targetProgress = motion.matches ? 0 : clamp(-bounds.top / travel);
      setChapter(
        motion.matches ? 0 : Math.min(2, Math.floor(targetProgress * 3)),
      );
      if (!animationFrame) resume();
    }
    function onMotionChange() {
      setReducedMotion(motion.matches);
      targetX = targetY = 0;
      measure();
      resume();
    }
    function onPointerMove(event: PointerEvent) {
      if (!finePointer.matches || motion.matches || pausedRef.current) return;
      const bounds = frame.getBoundingClientRect();
      targetX = clamp((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      targetY = clamp((event.clientY - bounds.top) / bounds.height) * 2 - 1;
      if (!animationFrame) resume();
    }
    function onPointerLeave() {
      targetX = targetY = 0;
      if (!animationFrame) resume();
    }
    function onPointerChange() {
      if (!finePointer.matches) onPointerLeave();
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    observer.observe(element);
    const size = new ResizeObserver(measure);
    size.observe(frame);
    setReady(true);
    setReducedMotion(motion.matches);
    paint();
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", onMotionChange);
    finePointer.addEventListener("change", onPointerChange);
    frame.addEventListener("pointermove", onPointerMove, { passive: true });
    frame.addEventListener("pointerleave", onPointerLeave);
    return () => {
      disposed = true;
      wake.current = () => {};
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      size.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", resume);
      motion.removeEventListener("change", onMotionChange);
      finePointer.removeEventListener("change", onPointerChange);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  function goToChapter(index: number) {
    const element = story.current!;
    const top = window.scrollY + element.getBoundingClientRect().top;
    const travel = Math.max(
      0,
      element.clientHeight - stage.current!.clientHeight,
    );
    window.scrollTo({
      top: top + travel * [0, 0.5, 0.98][index],
      behavior: paused ? "instant" : "smooth",
    });
  }

  return (
    <section
      ref={story}
      className="home-dashboard-story"
      aria-label="A preview of your Avielle wardrobe"
      data-motion-progress="0"
      data-motion-ready={ready}
      data-paused={paused}
      data-reduced-motion={reducedMotion}
      data-motion-active="false"
    >
      <noscript>
        <style>{`
          .home-dashboard-story { height: auto; min-height: 0; }
          .hero.home-dashboard-stage { position: relative; height: auto; min-height: 0; }
          .home-dashboard-preview { min-height: 430px; }
          .home-story-navigation { display: none; }
        `}</style>
      </noscript>
      <div ref={stage} className="hero home-dashboard-stage">
        <div className="hero-copy home-dashboard-copy">
          <h1 className="sr-only">Great style. A lighter footprint.</h1>
          <p className="eyebrow">
            <span className="tiny-line" /> THE SHARED WARDROBE
          </p>
          <div className="home-story-panels">
            <div className="home-story-panel" hidden={chapter !== 0}>
              <h2 aria-hidden="true">
                Great style.
                <br />A lighter
                <br />
                <em>footprint.</em>
              </h2>
              <p className="hero-description">
                Fall in love with what you wear.
                <br />
                Rent beautiful pieces. Share the ones you love.
                <br />
                Make room for more possibilities.
              </p>
            </div>
            <div className="home-story-panel" hidden={chapter !== 1}>
              <h2>
                A new look.
                <br />
                Another
                <br />
                <em>occasion.</em>
              </h2>
              <p className="hero-description">
                For the invitation. The celebration. The everyday.
                <br />
                Find a piece that feels like you.
                <br />
                Make it yours, for the moment.
              </p>
            </div>
            <div className="home-story-panel" hidden={chapter !== 2}>
              <h2>
                Loved by you.
                <br />
                <em>Shared</em>
                <br />
                again.
              </h2>
              <p className="hero-description">
                Good pieces deserve another chapter.
                <br />
                Open your wardrobe to someone else’s occasion.
                <br />
                Wear. Share. Repeat.
              </p>
            </div>
          </div>
          <div className="button-row">
            <Link href="/explore" className="button">
              Explore the wardrobe <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link href="/list" className="text-link">
              Start lending <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="hero-note">
            <Leaf size={17} strokeWidth={1.5} aria-hidden="true" />
            <span>A new way to wear what you love.</span>
          </div>
          <div
            className="home-story-navigation"
            aria-label="Wardrobe story chapters"
          >
            {chapters.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-label={`Go to chapter ${label}`}
                aria-current={chapter === index ? "step" : undefined}
                onClick={() => goToChapter(index)}
              >
                <span>0{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
        <figure
          className="home-dashboard-preview"
          aria-labelledby="home-preview-label"
          aria-describedby="home-preview-description"
        >
          <div className="home-preview-topline">
            <span id="home-preview-label">Dashboard design preview</span>
            {ready && !reducedMotion && (
              <button
                type="button"
                className="home-dashboard-pause"
                aria-label={
                  paused ? "Resume home animation" : "Pause home animation"
                }
                aria-pressed={paused}
                onClick={() => setPaused(!paused)}
              >
                {paused ? (
                  <Play size={12} aria-hidden="true" />
                ) : (
                  <Pause size={12} aria-hidden="true" />
                )}
                {paused ? "Resume" : "Pause"} motion
              </button>
            )}
          </div>
          <div className="home-dashboard-perspective">
            <div className="home-dashboard-scene" aria-hidden="true">
              <div className="home-preview-shell">
                <div className="home-preview-masthead">
                  <span>avielle</span>
                  <span>
                    THE WARDROBE JOURNAL{" "}
                    <span className="home-preview-monogram">a.</span>
                  </span>
                </div>
                <div className="home-preview-body">
                  <div className="home-preview-greeting">
                    <span className="home-preview-kicker">
                      YOUR PIECES. YOUR POSSIBILITIES.
                    </span>
                    <span className="home-preview-title">
                      Your wardrobe,
                      <br />
                      <em>in motion.</em>
                    </span>
                    <span className="home-preview-intro">
                      A little space for everything
                      <br />
                      you love to wear.
                    </span>
                    <div className="home-preview-tabs">
                      <span>I’m renting</span>
                      <span>I’m lending</span>
                    </div>
                  </div>
                  <div className="home-preview-editorial">
                    <img
                      src="/images/hero.jpg"
                      alt=""
                      width={260}
                      height={340}
                      decoding="async"
                      fetchPriority="high"
                    />
                    <span>THE AVIELLE EDIT</span>
                  </div>
                  <div className="home-preview-overview">
                    <span>
                      <CalendarDays size={15} />
                      Your occasions
                    </span>
                    <span>
                      <Heart size={15} />
                      Your saved pieces
                    </span>
                    <span>
                      <Sparkles size={15} />
                      Your closet journal
                    </span>
                  </div>
                  <div className="home-preview-rail">
                    <span className="home-preview-kicker">
                      THE DIGITAL WARDROBE
                    </span>
                    <div>
                      <span>
                        <img
                          src="/images/hero.jpg"
                          alt=""
                          loading="lazy"
                          width={160}
                          height={120}
                        />
                      </span>
                      <span className="home-preview-fabric">
                        Style,
                        <br />
                        <em>shared.</em>
                      </span>
                      <span>
                        <img
                          src="/images/hero.jpg"
                          alt=""
                          loading="lazy"
                          width={160}
                          height={120}
                        />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="home-preview-layer home-preview-closet">
                <div className="home-preview-float">
                  <div className="home-preview-closet-photo">
                    <img
                      src="/images/hero.jpg"
                      alt=""
                      loading="lazy"
                      width={180}
                      height={220}
                    />
                  </div>
                  <div>
                    <span className="home-preview-kicker">
                      A CLOSET WITH A POINT OF VIEW
                    </span>
                    <span className="home-preview-card-title">
                      Beautifully
                      <br />
                      <em>collected.</em>
                    </span>
                    <span className="home-preview-card-link">
                      Explore the wardrobe <ArrowUpRight size={12} />
                    </span>
                  </div>
                </div>
              </div>
              <div className="home-preview-layer home-preview-occasion">
                <div className="home-preview-float">
                  <CalendarDays size={20} strokeWidth={1.2} />
                  <span className="home-preview-kicker">MAKE ROOM FOR</span>
                  <span className="home-preview-card-title">
                    Your next
                    <br />
                    <em>occasion.</em>
                  </span>
                  <span className="home-preview-card-note">
                    Pick the piece. Find your moment.
                  </span>
                </div>
              </div>
              <div className="home-preview-layer home-preview-journal">
                <div className="home-preview-float">
                  <span className="home-preview-kicker">
                    THE CLOSET JOURNAL
                  </span>
                  <span className="home-preview-card-title">
                    Wear. Share.
                    <br />
                    <em>Repeat.</em>
                  </span>
                  <div className="home-preview-journal-row">
                    <span>
                      <Sparkles size={12} />
                      Discover a piece
                    </span>
                    <span>
                      <CalendarDays size={12} />
                      Plan your occasion
                    </span>
                    <span>
                      <ArrowUpRight size={12} />
                      Share your wardrobe
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <figcaption className="home-dashboard-caption">
            <span>
              YOUR STYLE.
              <br />A WORLD OF POSSIBILITIES.
            </span>
            <span id="home-preview-description">
              Illustrative layout · your activity appears after sign-in
            </span>
          </figcaption>
        </figure>
        <span className="home-dashboard-scroll" aria-hidden="true">
          SCROLL TO EXPLORE <ArrowDown size={14} />
        </span>
      </div>
    </section>
  );
}

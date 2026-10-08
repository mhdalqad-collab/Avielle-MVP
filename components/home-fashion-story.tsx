"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Leaf,
  Pause,
  Play,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { createFashionScene } from "./home-fashion-renderer";

type Scene = NonNullable<ReturnType<typeof createFashionScene>>;
const chapters = ["Discover", "Wear", "Share"];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** An original editorial sculpture, never a catalogue item or rental offer. */
export function HomeFashionStory() {
  const story = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(false);
  const wake = useRef<() => void>(() => {});
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visual, setVisual] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [chapter, setChapter] = useState(0);

  useEffect(() => {
    pausedRef.current = paused;
    wake.current();
  }, [paused]);

  useEffect(() => {
    const element = story.current!;
    const frameElement = stage.current!;
    const drawing = canvas.current!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let scene: Scene | null = null;
    let disposed = false;
    let visible = true;
    let animationFrame = 0;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let targetProgress = 0;
    let renderedProgress = 0;
    let pointerX = 0;
    let pointerY = 0;
    let lastDraw = 0;
    const started = performance.now();
    let lastOptions = {
      progress: 0,
      pointerX: 0,
      pointerY: 0,
      time: 0,
      reducedMotion: motion.matches,
    };

    function measure() {
      const bounds = element.getBoundingClientRect();
      const pinned = getComputedStyle(frameElement).position === "sticky";
      const travel = Math.max(
        1,
        pinned ? bounds.height - frameElement.clientHeight : bounds.height,
      );
      targetProgress = motion.matches ? 0 : clamp(-bounds.top / travel);
      setChapter(
        motion.matches ? 0 : Math.min(2, Math.floor(targetProgress * 3)),
      );
    }
    function draw(now: number) {
      if (!scene || disposed) return;
      if (!pausedRef.current || motion.matches) {
        renderedProgress = motion.matches
          ? 0
          : renderedProgress + (targetProgress - renderedProgress) * 0.18;
        lastOptions = {
          progress: renderedProgress,
          pointerX: motion.matches ? 0 : pointerX,
          pointerY: motion.matches ? 0 : pointerY,
          time: motion.matches ? 0 : now - started,
          reducedMotion: motion.matches,
        };
      }
      scene.render(lastOptions);
      element.dataset.motionProgress = lastOptions.progress.toFixed(3);
      lastDraw = now;
    }
    function animate(now: number) {
      animationFrame = 0;
      if (
        disposed ||
        !scene ||
        !visible ||
        document.hidden ||
        pausedRef.current ||
        motion.matches
      )
        return;
      // Thirty frames per second is sufficient for this slow editorial motion.
      if (now - lastDraw >= 1000 / 30) draw(now);
      animationFrame = requestAnimationFrame(animate);
    }
    function resume() {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (!scene || disposed) return;
      if (motion.matches) draw(performance.now());
      if (!motion.matches && !pausedRef.current && visible && !document.hidden)
        animationFrame = requestAnimationFrame(animate);
    }
    wake.current = resume;
    function resize() {
      scene?.resize(
        frameElement.querySelector(".home-fashion-visual")!.clientWidth,
        frameElement.querySelector(".home-fashion-visual")!.clientHeight,
      );
      measure();
      if (visible && !document.hidden) draw(performance.now());
    }
    function onMotionChange() {
      setReducedMotion(motion.matches);
      pointerX = pointerY = 0;
      measure();
      resume();
    }
    function onPointerMove(event: PointerEvent) {
      if (!pointer.matches || motion.matches || pausedRef.current) return;
      const bounds = frameElement.getBoundingClientRect();
      pointerX = clamp((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointerY = clamp((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    }
    function onPointerLeave() {
      pointerX = pointerY = 0;
    }
    function onContextLost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(animationFrame);
      scene?.dispose();
      scene = null;
      setVisual("fallback");
    }
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    visibility.observe(element);
    const size = new ResizeObserver(resize);
    size.observe(frameElement);
    setReducedMotion(motion.matches);
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", onMotionChange);
    frameElement.addEventListener("pointermove", onPointerMove, {
      passive: true,
    });
    frameElement.addEventListener("pointerleave", onPointerLeave);
    drawing.addEventListener("webglcontextlost", onContextLost);
    async function load() {
      try {
        const { createFashionScene } = await import("./home-fashion-renderer");
        if (disposed) return;
        scene = createFashionScene(drawing);
        if (!scene) return setVisual("fallback");
        resize();
        setVisual("ready");
        resume();
      } catch {
        if (!disposed) setVisual("fallback");
      }
    }
    if ("requestIdleCallback" in window)
      idle = window.requestIdleCallback(() => void load(), { timeout: 650 });
    else timer = setTimeout(() => void load(), 200);
    return () => {
      disposed = true;
      wake.current = () => {};
      cancelAnimationFrame(animationFrame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      clearTimeout(timer);
      visibility.disconnect();
      size.disconnect();
      scene?.dispose();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", resume);
      motion.removeEventListener("change", onMotionChange);
      frameElement.removeEventListener("pointermove", onPointerMove);
      frameElement.removeEventListener("pointerleave", onPointerLeave);
      drawing.removeEventListener("webglcontextlost", onContextLost);
    };
  }, []);

  function goToChapter(index: number) {
    const element = story.current!;
    const top = window.scrollY + element.getBoundingClientRect().top;
    const travel = element.clientHeight - stage.current!.clientHeight;
    window.scrollTo({
      top: top + travel * [0, 0.5, 0.98][index],
      behavior: reducedMotion || paused ? "instant" : "smooth",
    });
  }

  return (
    <section
      ref={story}
      className="home-fashion-story"
      aria-label="Avielle fashion story"
      data-motion-progress="0"
      data-visual-state={visual}
      data-paused={paused}
      data-reduced-motion={reducedMotion}
    >
      <div ref={stage} className="hero home-fashion-stage">
        <div className="hero-copy home-fashion-copy">
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
                Open your wardrobe to someone else's occasion.
                <br />
                Wear. Share. Repeat.
              </p>
            </div>
          </div>
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
          <div
            className="home-story-navigation"
            aria-label="Fashion story chapters"
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
        <figure className="hero-image home-fashion-visual">
          <img
            className="home-fashion-fallback"
            src="/images/hero.jpg"
            alt="Editorial portrait of a woman wearing an ivory tailored suit"
            fetchPriority="high"
            decoding="async"
            aria-hidden={visual === "ready"}
          />
          <canvas
            ref={canvas}
            className="home-fashion-canvas"
            role="img"
            aria-label="Three-dimensional ivory dress on a hanger"
            aria-hidden={visual !== "ready"}
          />
          <span className="home-fashion-edition" aria-hidden="true">
            AVIELLE / A STUDY IN SHARED STYLE
          </span>
          {visual === "ready" && !reducedMotion && (
            <button
              type="button"
              className="home-fashion-pause"
              aria-label={
                paused ? "Resume home animation" : "Pause home animation"
              }
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? (
                <Play size={13} aria-hidden="true" />
              ) : (
                <Pause size={13} aria-hidden="true" />
              )}
              {paused ? "Resume" : "Pause"} motion
            </button>
          )}
          <figcaption className="home-fashion-caption">
            <span>
              STYLE IS YOURS.
              <br />
              OWNERSHIP IS OPTIONAL.
            </span>
            <span>
              {visual === "ready"
                ? "Editorial illustration · not a rental listing"
                : "Editorial inspiration · not a rental listing"}
            </span>
          </figcaption>
        </figure>
        <span className="home-fashion-scroll" aria-hidden="true">
          SCROLL TO EXPLORE <ArrowDown size={14} />
        </span>
      </div>
    </section>
  );
}

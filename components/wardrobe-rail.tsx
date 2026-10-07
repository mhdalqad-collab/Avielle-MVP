"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ListingCard } from "./catalogue";
import type { Listing } from "./shared";

export function WardrobeRail({
  title,
  eyebrow,
  description,
  listings,
  currency,
  href,
  action = "Explore the wardrobe",
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  listings: Listing[];
  currency: string;
  href?: string;
  action?: string;
}) {
  const id = useId();
  const rail = useRef<HTMLDivElement>(null);
  const [canPrevious, setCanPrevious] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const measure = useCallback(() => {
    const element = rail.current;
    if (!element) return;
    setCanPrevious(element.scrollLeft > 2);
    setCanNext(
      element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    );
  }, []);

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [listings.length, measure]);

  function move(direction: number) {
    const element = rail.current;
    if (!element) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollBy({
      left: direction * Math.max(240, element.clientWidth * 0.8),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  if (!listings.length) return null;
  return (
    <section
      className="wardrobe-rail-section"
      aria-labelledby={`${id}-heading`}
    >
      <div className="wardrobe-rail-heading">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={`${id}-heading`}>{title}</h2>
          {description && (
            <p className="wardrobe-rail-description">{description}</p>
          )}
        </div>
        <div className="wardrobe-rail-actions">
          {href && (
            <Link href={href} className="text-link">
              {action} <ArrowRight size={15} aria-hidden="true" />
            </Link>
          )}
          <div className="wardrobe-rail-controls">
            <button
              type="button"
              aria-label={`Previous pieces in ${title}`}
              aria-controls={`${id}-rail`}
              disabled={!canPrevious}
              onClick={() => move(-1)}
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Next pieces in ${title}`}
              aria-controls={`${id}-rail`}
              disabled={!canNext}
              onClick={() => move(1)}
            >
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={rail}
        id={`${id}-rail`}
        className="wardrobe-rail"
        role="region"
        aria-label={`${title} pieces`}
        tabIndex={0}
        onScroll={measure}
        onLoad={measure}
      >
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} currency={currency} />
        ))}
      </div>
    </section>
  );
}

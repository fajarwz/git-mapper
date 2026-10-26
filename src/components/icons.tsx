/**
 * Icon index. The markup for every glyph lives in ../assets/*.svg; this module is a
 * thin `size`-prop wrapper over the svgr `?react` components so call sites keep their
 * API, and `currentColor` (declared inside each SVG file) keeps following the tone of
 * the parent button or label.
 */
import type { ComponentType } from "react";
import RawBranchIcon from "../assets/branch.svg?react";
import RawTagIcon from "../assets/tag.svg?react";
import RawRemoteIcon from "../assets/remote.svg?react";
import RawStashIcon from "../assets/stash.svg?react";
import RawRepoIcon from "../assets/repo.svg?react";
import RawPlusIcon from "../assets/plus.svg?react";
import RawChevronDownIcon from "../assets/chevron-down.svg?react";
import RawCloseIcon from "../assets/close.svg?react";
import RawSettingsIcon from "../assets/settings.svg?react";
import RawCheckIcon from "../assets/check.svg?react";
import RawSearchIcon from "../assets/search.svg?react";

interface IconProps {
  size?: number;
}

interface GlyphProps {
  size?: number;
  className?: string;
}

type SvgGlyph = ComponentType<{ width?: number; height?: number; className?: string }>;

function SizedIcon({ glyph, size, className }: { glyph: SvgGlyph; size: number; className?: string }) {
  const Glyph = glyph;
  return <Glyph width={size} height={size} className={className} />;
}

export function BranchIcon({ size = 12 }: IconProps) {
  return <SizedIcon glyph={RawBranchIcon} size={size} />;
}

export function TagIcon({ size = 12 }: IconProps) {
  return <SizedIcon glyph={RawTagIcon} size={size} />;
}

export function RemoteIcon({ size = 12 }: IconProps) {
  return <SizedIcon glyph={RawRemoteIcon} size={size} />;
}

export function StashIcon({ size = 12 }: IconProps) {
  return <SizedIcon glyph={RawStashIcon} size={size} />;
}

export function RepoIcon({ size = 14 }: IconProps) {
  return <SizedIcon glyph={RawRepoIcon} size={size} />;
}

export function PlusIcon({ size = 12 }: IconProps) {
  return <SizedIcon glyph={RawPlusIcon} size={size} />;
}

export function ChevronDownIcon({ size = 12, className = "" }: GlyphProps) {
  return <SizedIcon glyph={RawChevronDownIcon} size={size} className={className} />;
}

export function CloseIcon({ size = 12, className = "" }: GlyphProps) {
  return <SizedIcon glyph={RawCloseIcon} size={size} className={className} />;
}

export function SettingsIcon({ size = 14, className = "" }: GlyphProps) {
  return <SizedIcon glyph={RawSettingsIcon} size={size} className={className} />;
}

export function CheckIcon({ size = 12, className = "" }: GlyphProps) {
  return <SizedIcon glyph={RawCheckIcon} size={size} className={className} />;
}

export function SearchIcon({ size = 13, className = "" }: GlyphProps) {
  return <SizedIcon glyph={RawSearchIcon} size={size} className={className} />;
}

/* Fixed-size glyphs re-exported as-is; their dimensions live in the SVG files. */
export { default as BrandGlyph } from "../assets/brand.svg?react";
export { default as RefreshIcon } from "../assets/refresh.svg?react";
export { default as TextWrapIcon } from "../assets/text-wrap.svg?react";
export { default as WindowMinimizeIcon } from "../assets/window-minimize.svg?react";
export { default as WindowMaximizeIcon } from "../assets/window-maximize.svg?react";
export { default as WindowRestoreIcon } from "../assets/window-restore.svg?react";
export { default as WindowCloseIcon } from "../assets/window-close.svg?react";

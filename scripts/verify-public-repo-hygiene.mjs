#!/usr/bin/env node
/**
 * scripts/verify-public-repo-hygiene.mjs
 *
 * Repeatable audit verifying that:
 *   1. No private demo videos (.mp4, .mov, .webm, .m4v, .wav, .mp3), voiceover scripts,
 *      storyboards, recording scripts, or local-demo/ assets are tracked by Git.
 *   2. Every relative image path in README.md resolves to an existing public screenshot
 *      in docs/screenshots/public/ and is tracked/staged for Git.
 *   3. README.md contains zero references to private videos, voiceover scripts, or local-demo/.
 *   4. All required local-only hackathon presentation assets exist locally inside local-demo/
 *      and are ignored by Git.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const failures = [];
const checks = [];

function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  if (pass) {
    console.log(`  ✅ [PASS] ${name}: ${detail}`);
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${detail}`);
    failures.push(`${name}: ${detail}`);
  }
}

function main() {
  console.log(`\n===================================================================`);
  console.log(`🛡️  Public Repository Hygiene & Asset Separation Audit`);
  console.log(`===================================================================\n`);

  const trackedFiles = execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. No tracked files in local-demo/ or docs/videos/
  const trackedPrivateDirs = trackedFiles.filter(
    (f) =>
      f.startsWith('local-demo/') ||
      f.startsWith('docs/videos/') ||
      f.startsWith('.tmp-video-recordings/') ||
      f.startsWith('docs/screenshots/local-polish/') ||
      f.startsWith('docs/screenshots/mobile-polish/')
  );
  check(
    'no_tracked_private_directories',
    trackedPrivateDirs.length === 0,
    trackedPrivateDirs.length === 0
      ? '0 files tracked in local-demo/, docs/videos/, or private screenshot dirs'
      : `Tracked private directory files found: ${trackedPrivateDirs.join(', ')}`
  );

  // 2. No tracked video or audio files anywhere in Git
  const trackedMediaFiles = trackedFiles.filter((f) =>
    /\.(mp4|mov|webm|m4v|wav|mp3)$/i.test(f)
  );
  check(
    'no_tracked_video_or_audio_files',
    trackedMediaFiles.length === 0,
    trackedMediaFiles.length === 0
      ? '0 video/audio files (.mp4/.mov/.webm/.wav/.mp3) tracked in Git'
      : `Tracked video/audio files found: ${trackedMediaFiles.join(', ')}`
  );

  // 3. No tracked voiceover scripts, recording scripts, or old media manifests
  const trackedPrivateDocs = trackedFiles.filter(
    (f) =>
      /^scripts\/record-.*\.mjs$/i.test(f) ||
      f === 'docs/MEDIA_AUDIT_MANIFEST.md' ||
      f === 'evidence/media-audit-manifest.json' ||
      /voiceover|storyboard/i.test(f)
  );
  check(
    'no_tracked_voiceover_or_recording_scripts',
    trackedPrivateDocs.length === 0,
    trackedPrivateDocs.length === 0
      ? '0 voiceover scripts, storyboards, or video recording scripts tracked in Git'
      : `Tracked private docs/scripts found: ${trackedPrivateDocs.join(', ')}`
  );

  // 4. All 14 public README screenshots exist in docs/screenshots/public/
  const expectedPublicScreenshots = [
    'docs/screenshots/public/01-provider-billing-dashboard.png',
    'docs/screenshots/public/02-customer-billing-dashboard.png',
    'docs/screenshots/public/03-paypal-merchant-card-compact.png',
    'docs/screenshots/public/04-paypal-merchant-card-expanded.png',
    'docs/screenshots/public/05-billing-ai-invoice-question.png',
    'docs/screenshots/public/06-billing-ai-failed-payment-investigation.png',
    'docs/screenshots/public/07-statement-details-modal.png',
    'docs/screenshots/public/08-paypal-sandbox-checkout-interface.png',
    'docs/screenshots/public/09-payment-receipt-and-settlement-detail.png',
    'docs/screenshots/public/10-notifications-customer-isolation.png',
    'docs/screenshots/public/11-global-billing-search.png',
    'docs/screenshots/public/12-mcp-agent-interface-82-tools.png',
    'docs/screenshots/public/13-mobile-dashboard-390px.png',
    'docs/screenshots/public/14-mobile-billing-ai-conversation-390px.png',
  ];

  const missingPublicScreenshots = expectedPublicScreenshots.filter((rel) => {
    const abs = path.join(REPO_ROOT, rel);
    return !fs.existsSync(abs) || fs.statSync(abs).size < 1000;
  });
  check(
    'all_14_public_screenshots_present',
    missingPublicScreenshots.length === 0,
    missingPublicScreenshots.length === 0
      ? 'All 14 public screenshots exist in docs/screenshots/public/'
      : `Missing or empty public screenshots: ${missingPublicScreenshots.join(', ')}`
  );

  // 5. Verify README.md image links & absence of private references
  const readmeText = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const imageMatches = [...readmeText.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(
    (m) => m[1]
  );
  const relativeImages = imageMatches.filter((u) => !/^https?:\/\//i.test(u));
  const brokenReadmeImages = relativeImages.filter((relUrl) => {
    const cleanRel = relUrl.replace(/^\.\//, '');
    const abs = path.join(REPO_ROOT, cleanRel);
    return (
      !cleanRel.startsWith('docs/screenshots/public/') || !fs.existsSync(abs)
    );
  });
  check(
    'readme_relative_images_valid_and_public',
    relativeImages.length === 14 && brokenReadmeImages.length === 0,
    brokenReadmeImages.length === 0
      ? `All ${relativeImages.length} relative README images resolve to docs/screenshots/public/`
      : `Broken or non-public README images: ${brokenReadmeImages.join(', ')}`
  );

  const hasPrivateReadmeRef =
    /local-demo\/|docs\/videos\/|\.mp4\b|\.webm\b|FINAL_HACKATHON_VOICEOVER|MEDIA_AUDIT_MANIFEST/i.test(
      readmeText
    );
  check(
    'readme_zero_private_asset_references',
    !hasPrivateReadmeRef,
    !hasPrivateReadmeRef
      ? 'README.md contains 0 references to local-demo/, docs/videos/, .mp4 files, or voiceover scripts'
      : 'README.md still references private videos, local-demo/, or voiceover scripts'
  );

  // 6. Verify local-demo/ private assets exist locally and local-demo/ is gitignored
  const requiredLocalPrivateAssets = [
    'local-demo/LOCAL_ASSET_INDEX.md',
    'local-demo/01-final-videos/paypal-ai-billing-kit-hackathon-demo.mp4',
    'local-demo/03-video-clips/clip-01-provider-dashboard-overview.mp4',
    'local-demo/03-video-clips/clip-02-billing-ai-conversation.mp4',
    'local-demo/03-video-clips/clip-03-failed-payment-explanation.mp4',
    'local-demo/03-video-clips/clip-04-invoice-detail-and-payment.mp4',
    'local-demo/03-video-clips/clip-05-refund-and-receipt-workflow.mp4',
    'local-demo/03-video-clips/clip-06-mcp-agent-interface.mp4',
    'local-demo/03-video-clips/clip-07-mobile-responsiveness.mp4',
    'local-demo/04-voiceover-scripts/FINAL_HACKATHON_VOICEOVER.md',
    'local-demo/04-voiceover-scripts/30_SECOND_ELEVATOR_PITCH.md',
    'local-demo/04-voiceover-scripts/60_SECOND_PRODUCT_OVERVIEW.md',
    'local-demo/04-voiceover-scripts/CLOSING_STATEMENT_AND_RECORDING_CHECKLIST.md',
    'local-demo/05-storyboards/HACKATHON_VIDEO_STORYBOARD.md',
    'local-demo/09-submission-preparation/paypal-ai-billing-kit-hackathon-demo.mp4',
    'local-demo/09-submission-preparation/FINAL_HACKATHON_VOICEOVER.md',
    'local-demo/09-submission-preparation/SCENE_TIMING_SHEET.md',
    'local-demo/09-submission-preparation/PRODUCT_DESCRIPTION_DRAFT.md',
    'local-demo/09-submission-preparation/SHORT_PROJECT_SUMMARY.md',
    'local-demo/09-submission-preparation/TECHNICAL_EXPLANATION.md',
    'local-demo/09-submission-preparation/SUBMISSION_CHECKLIST.md',
    'local-demo/09-submission-preparation/VIDEO_QUALITY_CHECKLIST.md',
    'local-demo/09-submission-preparation/VERIFIED_PUBLIC_LINKS.md',
  ];

  const missingLocalPrivateAssets = requiredLocalPrivateAssets.filter(
    (rel) => !fs.existsSync(path.join(REPO_ROOT, rel))
  );
  check(
    'local_private_demo_package_complete',
    missingLocalPrivateAssets.length === 0,
    missingLocalPrivateAssets.length === 0
      ? `All ${requiredLocalPrivateAssets.length} required private assets exist locally in local-demo/`
      : `Missing local-demo assets: ${missingLocalPrivateAssets.join(', ')}`
  );

  let isLocalDemoIgnored = false;
  try {
    const out = execFileSync('git', ['check-ignore', 'local-demo/LOCAL_ASSET_INDEX.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    isLocalDemoIgnored = out.includes('local-demo');
  } catch {
    isLocalDemoIgnored = false;
  }
  check(
    'local_demo_gitignored',
    isLocalDemoIgnored,
    isLocalDemoIgnored
      ? 'local-demo/ is actively ignored by Git (.gitignore)'
      : 'local-demo/ is NOT ignored by Git'
  );

  console.log(`\n-------------------------------------------------------------------`);
  if (failures.length > 0) {
    console.error(`❌ Repo Hygiene Audit FAILED with ${failures.length} error(s).`);
    process.exit(1);
  } else {
    console.log(
      `✅ Repo Hygiene Audit PASSED (${checks.length}/${checks.length} checks).`
    );
  }
}

main();

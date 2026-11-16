import { LeaderboardMockEntry, LeaderboardOverallEntry } from '../types/mockrank';
import { formatDurationHuman } from './clientExamEngine';

export interface LeaderboardExportConfig {
  mode: 'overall' | 'mock';
  title: string;
  subtitle: string;
  theme?: 'light' | 'dark';
  maxRows?: number;
  overallEntries?: LeaderboardOverallEntry[];
  mockEntries?: LeaderboardMockEntry[];
}

export interface GeneratedLeaderboardImage {
  blob: Blob;
  dataUrl: string;
  filename: string;
  shareText: string;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

export function buildLeaderboardShareText(config: LeaderboardExportConfig): string {
  const limit = config.maxRows || 15;
  const lines: string[] = [
    `🏆 ${config.title}`,
    `📋 ${config.subtitle}`,
    `────────────────────────────`,
  ];

  if (config.mode === 'overall') {
    const rows = (config.overallEntries || []).slice(0, limit);
    rows.forEach((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`;
      lines.push(
        `${medal} ${e.candidateName} — Avg: ${e.averageScore.toFixed(2)} (Part A: ${(
          e.partAAverageScore || 0
        ).toFixed(2)} | Part B: ${(e.partBAverageScore || 0).toFixed(2)}) · ${
          e.mocksAttempted
        } Mock${e.mocksAttempted === 1 ? '' : 's'}`
      );
    });
  } else {
    const rows = (config.mockEntries || []).slice(0, limit);
    rows.forEach((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`;
      lines.push(
        `${medal} ${e.candidateName} — Score: ${e.score.toFixed(2)} | Acc: ${e.accuracy.toFixed(
          1
        )}% | Time: ${formatDurationHuman(e.timeTakenSeconds)}`
      );
    });
  }

  lines.push(`────────────────────────────`);
  lines.push(`Generated via MockRank — DSSSB TGT Computer Science Portal`);
  return lines.join('\n');
}

export async function generateLeaderboardImage(
  config: LeaderboardExportConfig
): Promise<GeneratedLeaderboardImage> {
  const isDark = config.theme === 'dark';
  const maxRows = config.maxRows || 25;

  const overallRows =
    config.mode === 'overall' ? (config.overallEntries || []).slice(0, maxRows) : [];
  const mockRows =
    config.mode === 'mock' ? (config.mockEntries || []).slice(0, maxRows) : [];

  const rowCount = config.mode === 'overall' ? overallRows.length : mockRows.length;
  const hasTopPodium = rowCount > 0;

  const width = 1080;
  const outerPad = 44;
  const headerHeight = 148;
  const podiumSectionHeight = hasTopPodium ? 142 : 0;
  const tableHeaderHeight = 50;
  const rowHeight = 52;
  const emptyStateHeight = rowCount === 0 ? 140 : 0;
  const footerHeight = 72;

  const totalHeight =
    outerPad * 2 +
    headerHeight +
    podiumSectionHeight +
    tableHeaderHeight +
    rowCount * rowHeight +
    emptyStateHeight +
    footerHeight;

  const scale = 2; // 2x Retina DPI (2160px wide)
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = totalHeight * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available in this browser.');
  }

  ctx.scale(scale, scale);

  // Palette
  const bgCanvas = isDark ? '#020617' : '#f8fafc';
  const cardBg = isDark ? '#0f172a' : '#ffffff';
  const cardBorder = isDark ? '#1e293b' : '#e2e8f0';
  const headerBannerBg = isDark ? '#0f172a' : '#0f172a';
  const textPrimary = isDark ? '#f8fafc' : '#0f172a';
  const textSecondary = isDark ? '#94a3b8' : '#475569';
  const textMuted = isDark ? '#64748b' : '#64748b';
  const tableHeaderBg = isDark ? '#1e293b' : '#f1f5f9';
  const rowAltBg = isDark ? '#131c31' : '#f8fafc';

  // Background fill
  ctx.fillStyle = bgCanvas;
  ctx.fillRect(0, 0, width, totalHeight);

  // Main outer card container
  const cardX = outerPad;
  const cardY = outerPad;
  const cardW = width - outerPad * 2;
  const cardH = totalHeight - outerPad * 2;

  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 16);
  ctx.fillStyle = cardBg;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = cardBorder;
  ctx.stroke();

  // Top Header Banner (Dark Slate Authority Header)
  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, cardW, headerHeight, 16);
  ctx.clip();
  ctx.fillStyle = headerBannerBg;
  ctx.fillRect(cardX, cardY, cardW, headerHeight);

  // Subtle emerald accent stripe at top of header
  ctx.fillStyle = '#10b981';
  ctx.fillRect(cardX, cardY, cardW, 5);

  // Brand Kicker
  ctx.fillStyle = '#34d399';
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText('MOCKRANK · DSSSB TGT COMPUTER SCIENCE OFFICIAL STANDINGS', cardX + 32, cardY + 42);

  // Main Title
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncateText(ctx, config.title, cardW - 260), cardX + 32, cardY + 84);

  // Subtitle
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '500 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(truncateText(ctx, config.subtitle, cardW - 260), cardX + 32, cardY + 116);

  // Right-side Date & Candidates Count
  const nowStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText(`DATE: ${nowStr.toUpperCase()}`, cardX + cardW - 32, cardY + 44);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText(`${rowCount} Candidates`, cardX + cardW - 32, cardY + 82);

  ctx.fillStyle = '#34d399';
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText('VERIFIED LEADERBOARD', cardX + cardW - 32, cardY + 114);
  ctx.textAlign = 'left';
  ctx.restore();

  let cursorY = cardY + headerHeight;

  // Top 3 Podium Strip
  if (hasTopPodium) {
    const podiumPadX = 28;
    const podiumGap = 16;
    const boxW = (cardW - podiumPadX * 2 - podiumGap * 2) / 3;
    const boxH = 104;
    const boxY = cursorY + 20;

    const topThree =
      config.mode === 'overall'
        ? overallRows.slice(0, 3).map((e) => ({
            rank: e.rank || 1,
            name: e.candidateName,
            score: `${e.averageScore.toFixed(2)} Avg`,
            meta: `Part A: ${(e.partAAverageScore || 0).toFixed(2)} · Part B: ${(
              e.partBAverageScore || 0
            ).toFixed(2)}`,
          }))
        : mockRows.slice(0, 3).map((e) => ({
            rank: e.rank || 1,
            name: e.candidateName,
            score: `${e.score.toFixed(2)} Marks`,
            meta: `Acc: ${e.accuracy.toFixed(1)}% · Time: ${formatDurationHuman(
              e.timeTakenSeconds
            )}`,
          }));

    const podiumStyles = [
      {
        label: 'RANK #1 · GOLD',
        border: '#f59e0b',
        bg: isDark ? '#271f0b' : '#fffbeb',
        badge: '#d97706',
      },
      {
        label: 'RANK #2 · SILVER',
        border: '#94a3b8',
        bg: isDark ? '#1e293b' : '#f8fafc',
        badge: '#475569',
      },
      {
        label: 'RANK #3 · BRONZE',
        border: '#d97706',
        bg: isDark ? '#261710' : '#fff7ed',
        badge: '#b45309',
      },
    ];

    topThree.forEach((item, idx) => {
      const style = podiumStyles[idx] || podiumStyles[1];
      const bx = cardX + podiumPadX + idx * (boxW + podiumGap);

      drawRoundedRect(ctx, bx, boxY, boxW, boxH, 10);
      ctx.fillStyle = style.bg;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = style.border;
      ctx.stroke();

      ctx.fillStyle = style.badge;
      ctx.font = '800 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText(style.label, bx + 16, boxY + 24);

      ctx.fillStyle = textPrimary;
      ctx.font = '700 17px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(truncateText(ctx, item.name, boxW - 125), bx + 16, boxY + 54);

      ctx.textAlign = 'right';
      ctx.fillStyle = isDark ? '#34d399' : '#047857';
      ctx.font = '800 16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText(item.score, bx + boxW - 16, boxY + 54);
      ctx.textAlign = 'left';

      ctx.fillStyle = textSecondary;
      ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText(truncateText(ctx, item.meta, boxW - 32), bx + 16, boxY + 84);
    });

    cursorY += podiumSectionHeight;
  }

  // Table Header Bar
  ctx.fillStyle = tableHeaderBg;
  ctx.fillRect(cardX + 1, cursorY, cardW - 2, tableHeaderHeight);

  ctx.strokeStyle = cardBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, cursorY);
  ctx.lineTo(cardX + cardW, cursorY);
  ctx.moveTo(cardX, cursorY + tableHeaderHeight);
  ctx.lineTo(cardX + cardW, cursorY + tableHeaderHeight);
  ctx.stroke();

  const colRankX = cardX + 32;
  const colNameX = cardX + 125;
  const colScoreRightX = cardX + 510;
  const colCol4RightX = cardX + 660;
  const colCol5RightX = cardX + 810;
  const colCol6RightX = cardX + cardW - 32;

  ctx.fillStyle = textSecondary;
  ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  const thY = cursorY + 30;

  ctx.textAlign = 'left';
  ctx.fillText('RANK', colRankX, thY);
  ctx.fillText('CANDIDATE USERNAME', colNameX, thY);

  ctx.textAlign = 'right';
  if (config.mode === 'overall') {
    ctx.fillText('AVG SCORE', colScoreRightX, thY);
    ctx.fillText('PART A AVG', colCol4RightX, thY);
    ctx.fillText('PART B AVG', colCol5RightX, thY);
    ctx.fillText('MOCKS · ACC%', colCol6RightX, thY);
  } else {
    ctx.fillText('TOTAL SCORE', colScoreRightX, thY);
    ctx.fillText('CORRECT Qs', colCol4RightX, thY);
    ctx.fillText('ACCURACY', colCol5RightX, thY);
    ctx.fillText('TIME TAKEN', colCol6RightX, thY);
  }
  ctx.textAlign = 'left';

  cursorY += tableHeaderHeight;

  if (rowCount === 0) {
    ctx.fillStyle = textSecondary;
    ctx.font = '600 16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      'No verified candidate attempts in this cohort yet.',
      cardX + cardW / 2,
      cursorY + emptyStateHeight / 2 + 6
    );
    ctx.textAlign = 'left';
    cursorY += emptyStateHeight;
  } else if (config.mode === 'overall') {
    overallRows.forEach((entry, index) => {
      const ry = cursorY + index * rowHeight;
      if (index % 2 === 1) {
        ctx.fillStyle = rowAltBg;
        ctx.fillRect(cardX + 1, ry, cardW - 2, rowHeight);
      }

      // Row divider
      ctx.strokeStyle = cardBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cardX + 20, ry + rowHeight);
      ctx.lineTo(cardX + cardW - 20, ry + rowHeight);
      ctx.stroke();

      const textY = ry + 32;
      const rankNum = entry.rank || index + 1;

      // Rank
      ctx.font = '800 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle =
        rankNum === 1
          ? '#d97706'
          : rankNum === 2
          ? '#64748b'
          : rankNum === 3
          ? '#b45309'
          : textPrimary;
      ctx.fillText(`#${rankNum}`, colRankX, textY);

      // Candidate Name
      ctx.font = '600 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = textPrimary;
      ctx.fillText(truncateText(ctx, entry.candidateName, 250), colNameX, textY);

      // Right-aligned metrics
      ctx.textAlign = 'right';
      ctx.font = '800 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle = isDark ? '#34d399' : '#047857';
      ctx.fillText(entry.averageScore.toFixed(2), colScoreRightX, textY);

      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle = textPrimary;
      ctx.fillText((entry.partAAverageScore || 0).toFixed(2), colCol4RightX, textY);
      ctx.fillText((entry.partBAverageScore || 0).toFixed(2), colCol5RightX, textY);

      ctx.fillStyle = textSecondary;
      ctx.fillText(
        `${entry.mocksAttempted}M · ${entry.averageAccuracy.toFixed(1)}%`,
        colCol6RightX,
        textY
      );
      ctx.textAlign = 'left';
    });
    cursorY += rowCount * rowHeight;
  } else {
    mockRows.forEach((entry, index) => {
      const ry = cursorY + index * rowHeight;
      if (index % 2 === 1) {
        ctx.fillStyle = rowAltBg;
        ctx.fillRect(cardX + 1, ry, cardW - 2, rowHeight);
      }

      ctx.strokeStyle = cardBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cardX + 20, ry + rowHeight);
      ctx.lineTo(cardX + cardW - 20, ry + rowHeight);
      ctx.stroke();

      const textY = ry + 32;
      const rankNum = entry.rank || index + 1;

      ctx.font = '800 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle =
        rankNum === 1
          ? '#d97706'
          : rankNum === 2
          ? '#64748b'
          : rankNum === 3
          ? '#b45309'
          : textPrimary;
      ctx.fillText(`#${rankNum}`, colRankX, textY);

      ctx.font = '600 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = textPrimary;
      ctx.fillText(truncateText(ctx, entry.candidateName, 250), colNameX, textY);

      ctx.textAlign = 'right';
      ctx.font = '800 15px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle = isDark ? '#34d399' : '#047857';
      ctx.fillText(entry.score.toFixed(2), colScoreRightX, textY);

      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillStyle = textPrimary;
      ctx.fillText(String(entry.correctAnswers), colCol4RightX, textY);
      ctx.fillText(`${entry.accuracy.toFixed(1)}%`, colCol5RightX, textY);

      ctx.fillStyle = textSecondary;
      ctx.fillText(formatDurationHuman(entry.timeTakenSeconds), colCol6RightX, textY);
      ctx.textAlign = 'left';
    });
    cursorY += rowCount * rowHeight;
  }

  // Footer
  const footerY = cursorY + 42;
  ctx.fillStyle = textMuted;
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillText(
    'MockRank Official CBT Evaluation · Equal-Mocks Fair Cohort Ranking System',
    cardX + 32,
    footerY
  );

  ctx.textAlign = 'right';
  ctx.fillText(
    `Generated on ${new Date().toLocaleString('en-IN')}`,
    cardX + cardW - 32,
    footerY
  );
  ctx.textAlign = 'left';

  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode leaderboard PNG blob.'));
    }, 'image/png');
  });

  const safeSlug = config.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  const datePart = new Date().toISOString().slice(0, 10);
  const filename = `${safeSlug || 'mockrank-leaderboard'}-${datePart}.png`;

  return {
    blob,
    dataUrl,
    filename,
    shareText: buildLeaderboardShareText(config),
  };
}

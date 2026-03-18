/**
 * system-info.ts
 *
 * Reads and formats host system information (GPU, CPU, memory) for Slack display.
 * All reads are best-effort — missing values are reported as "n/a".
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import type { KnownBlock } from '@slack/types';

const execFileAsync = promisify(execFile);

// ─── Raw system data ─────────────────────────────────────────────────────────

export interface GpuInfo {
  name: string;
  memoryUsedMiB: number;
  memoryTotalMiB: number;
  utilizationPercent: number;
  temperatureC?: number;
}

export interface CpuInfo {
  model: string;
  physicalCores: number;
  logicalCores: number;
  loadPercent1m: number;
  loadPercent5m: number;
}

export interface MemoryInfo {
  totalGiB: number;
  usedGiB: number;
  freeGiB: number;
  usedPercent: number;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpus: GpuInfo[];
  collectedAt: Date;
}

// ─── Collectors ──────────────────────────────────────────────────────────────

async function collectGpus(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu',
      '--format=csv,noheader,nounits',
    ]);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, memUsed, memTotal, util, temp] = line.split(',').map((s) => s.trim());
        return {
          name: name ?? 'Unknown GPU',
          memoryUsedMiB: parseInt(memUsed ?? '0', 10),
          memoryTotalMiB: parseInt(memTotal ?? '0', 10),
          utilizationPercent: parseInt(util ?? '0', 10),
          temperatureC: temp ? parseInt(temp, 10) : undefined,
        };
      });
  } catch {
    // nvidia-smi not available
    return [];
  }
}

async function collectMemory(): Promise<MemoryInfo> {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  const toGiB = (b: number) => b / 1024 ** 3;

  return {
    totalGiB: toGiB(totalBytes),
    usedGiB: toGiB(usedBytes),
    freeGiB: toGiB(freeBytes),
    usedPercent: (usedBytes / totalBytes) * 100,
  };
}

async function collectCpu(): Promise<CpuInfo> {
  const cpus = os.cpus();
  const load = os.loadavg();
  const logicalCores = cpus.length;

  // Best-effort physical core count via lscpu on Linux
  let physicalCores = logicalCores;
  try {
    const { stdout } = await execFileAsync('lscpu', []);
    const match = stdout.match(/^Core\(s\) per socket:\s+(\d+)/m);
    const socketMatch = stdout.match(/^Socket\(s\):\s+(\d+)/m);
    if (match && socketMatch) {
      physicalCores = parseInt(match[1]!, 10) * parseInt(socketMatch[1]!, 10);
    }
  } catch {
    // lscpu not available
  }

  return {
    model: cpus[0]?.model ?? 'Unknown CPU',
    physicalCores,
    logicalCores,
    loadPercent1m: (load[0]! / logicalCores) * 100,
    loadPercent5m: (load[1]! / logicalCores) * 100,
  };
}

/**
 * Collect all system info. Individual failures are swallowed and reported as defaults.
 */
export async function collectSystemInfo(): Promise<SystemInfo> {
  const [cpu, memory, gpus] = await Promise.all([
    collectCpu(),
    collectMemory(),
    collectGpus(),
  ]);

  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpu,
    memory,
    gpus,
    collectedAt: new Date(),
  };
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function bar(percent: number, width = 10): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function gib(v: number): string {
  return `${v.toFixed(1)} GiB`;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

/**
 * Plain-text summary of system resources.
 */
export function formatSystemInfoText(info: SystemInfo): string {
  const lines: string[] = [
    `Host: ${info.hostname}  (${info.platform})`,
    `CPU:  ${info.cpu.model}  ${info.cpu.physicalCores}c/${info.cpu.logicalCores}t` +
      `  load ${pct(info.cpu.loadPercent1m)} / ${pct(info.cpu.loadPercent5m)}`,
    `RAM:  ${gib(info.memory.usedGiB)} / ${gib(info.memory.totalGiB)}` +
      `  ${pct(info.memory.usedPercent)}  [${bar(info.memory.usedPercent)}]`,
  ];

  if (info.gpus.length > 0) {
    for (const [i, g] of info.gpus.entries()) {
      const memPct = (g.memoryUsedMiB / g.memoryTotalMiB) * 100;
      const temp = g.temperatureC != null ? `  ${g.temperatureC}°C` : '';
      lines.push(
        `GPU${i}: ${g.name}  ${g.memoryUsedMiB}/${g.memoryTotalMiB} MiB` +
          `  util ${pct(g.utilizationPercent)}${temp}  [${bar(memPct)}]`,
      );
    }
  } else {
    lines.push('GPU:  n/a');
  }

  return lines.join('\n');
}

/**
 * Slack Block Kit blocks for system info display.
 */
export function formatSystemInfoBlocks(info: SystemInfo): KnownBlock[] {
  const memPct = info.memory.usedPercent;
  const cpuLoad = info.cpu.loadPercent1m;

  const fields = [
    {
      type: 'mrkdwn' as const,
      text: `*CPU*\n${info.cpu.model}\n${info.cpu.physicalCores}c/${info.cpu.logicalCores}t  load: ${pct(cpuLoad)}`,
    },
    {
      type: 'mrkdwn' as const,
      text: `*Memory*\n${gib(info.memory.usedGiB)} / ${gib(info.memory.totalGiB)}\n${pct(memPct)} used  \`${bar(memPct)}\``,
    },
  ];

  for (const [i, g] of info.gpus.entries()) {
    const memPct2 = (g.memoryUsedMiB / g.memoryTotalMiB) * 100;
    const temp = g.temperatureC != null ? `  ${g.temperatureC}°C` : '';
    fields.push({
      type: 'mrkdwn' as const,
      text:
        `*GPU ${i} — ${g.name}*\n` +
        `${g.memoryUsedMiB}/${g.memoryTotalMiB} MiB  util: ${pct(g.utilizationPercent)}${temp}\n\`${bar(memPct2)}\``,
    });
  }

  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: `System Info — ${info.hostname}`, emoji: false } },
    { type: 'section', fields } as KnownBlock,
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Collected <!date^${Math.floor(info.collectedAt.getTime() / 1000)}^at {time}|${info.collectedAt.toISOString()}>  •  ${info.platform}`,
        },
      ],
    },
  ];

  return blocks;
}

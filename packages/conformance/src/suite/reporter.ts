import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

interface CheckEntry {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
  durationMs: number;
}

const ID_RE = /^\[([A-Za-z0-9]+)\]\s*(.*)$/;

export default class ConformanceReporter implements Reporter {
  private checks = new Map<string, CheckEntry>();
  private reportDir = process.env.VENDUA_QA_REPORT_DIR ?? 'qa-report';
  private storefront = process.env.VENDUA_STOREFRONT_DIR ?? '';

  onBegin(_config: FullConfig, _suite: Suite) {
    this.checks.clear();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const m = ID_RE.exec(test.title);
    const id = m ? m[1]!.toUpperCase() : 'ARTIFACTS';
    const title = m ? m[2]! : test.title;
    const status =
      result.status === 'passed' ? 'pass' : result.status === 'skipped' ? 'skip' : 'fail';
    const reason = test.annotations.find((a) => a.type === 'reason')?.description;
    const detail =
      status === 'fail'
        ? (result.errors.map((e) => e.message ?? String(e)).join('\n') || 'failed').slice(0, 4000)
        : status === 'skip'
          ? (reason ?? 'skipped')
          : undefined;

    const tag = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'SKIP';
    console.log(`${tag} ${id} ${title}${detail && status !== 'fail' ? ` — ${detail}` : ''}`);

    const prev = this.checks.get(id);
    this.checks.set(id, {
      id,
      title,
      status: prev?.status === 'fail' ? 'fail' : status,
      ...(detail ? { detail } : prev?.detail ? { detail: prev.detail } : {}),
      durationMs: (prev?.durationMs ?? 0) + result.duration,
    });
  }

  onEnd(_result: FullResult) {
    mkdirSync(this.reportDir, { recursive: true });
    const checks = [...this.checks.values()].sort((a, b) => a.id.localeCompare(b.id));
    const report = {
      storefront: this.storefront,
      generatedAt: new Date().toISOString(),
      summary: {
        pass: checks.filter((c) => c.status === 'pass').length,
        fail: checks.filter((c) => c.status === 'fail').length,
        skip: checks.filter((c) => c.status === 'skip').length,
      },
      checks,
    };
    const out = join(this.reportDir, 'report.json');
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`qa report → ${out}`);
  }
}

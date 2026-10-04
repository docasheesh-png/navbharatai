// Autopsy 51ef24ad (2026-10-04): "Build app in this format" over a 54-file Android project. The
// frontend specialist hit its 40-step cap after reading Kotlin sources it was never handed (78 reads,
// 34 files), and the ETA said ~8 min for a 19-minute port. Each half is locked here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  foreignSourcePaths, isPortTurn, declarationsOf, isModelFile, collectPortSources, portDigest,
  PORT_DIGEST_MAX_CHARS,
} from '../src/server/AgentV3/portDigest';
import { filesNamedIn } from '../src/server/AgentV3/taskHandoff';
import { projectSizedComplexity, complexityFromPrompt } from '../src/server/lib/BuildTimeEstimator';

const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
const subAgent = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');

// The report's own project layout (paths from its REPEATED_READS and tool calls).
const TARGET_AS = [
  'app/build.gradle.kts',
  'app/src/main/AndroidManifest.xml',
  'app/src/main/java/com/example/MainActivity.kt',
  'app/src/main/java/com/example/data/models/ExamModels.kt',
  'app/src/main/java/com/example/data/repository/AssamExamDataProvider.kt',
  'app/src/main/java/com/example/data/repository/ExamRepository.kt',
  'app/src/main/java/com/example/ui/MainViewModel.kt',
  'app/src/main/java/com/example/ui/screens/HomeScreen.kt',
  'app/src/main/java/com/example/ui/screens/SettingsScreen.kt',
  'app/src/main/java/com/example/ui/screens/StudyPlannerScreen.kt',
  'app/src/main/java/com/example/ui/screens/TestAnalysisScreen.kt',
  'app/src/test/java/com/example/ExampleUnitTest.kt',
  'app/build/generated/source/R.java',
  'src/App.tsx',
  'package.json',
];

const MODELS = `package com.example.data.models

data class Exam(val id: String, val name: String, val date: String)
enum class Subject { MATH, SCIENCE, GK }`;

const HOME = `package com.example.ui.screens

import androidx.compose.runtime.Composable

@Composable
fun HomeScreen(viewModel: MainViewModel, onOpen: (String) -> Unit) {
    val exams = viewModel.exams
    Column { Text("Upcoming exams") }
}

@Composable
private fun ExamCard(exam: Exam) {
    Card { Text(exam.name) }
}`;

describe('which projects are ports', () => {
  it('keeps app sources, screens and models first; drops tests, build output and web files', () => {
    const paths = foreignSourcePaths(TARGET_AS);
    expect(paths.slice(0, 5).every((p) => /(Screen|Activity)\.kt$/.test(p))).toBe(true);
    expect(paths).toContain('app/src/main/java/com/example/data/models/ExamModels.kt');
    expect(paths.some((p) => /ExampleUnitTest|R\.java|App\.tsx|gradle/.test(p))).toBe(false);
    expect(paths).toHaveLength(9);
  });
  it('fires only for a build ORDER over a project with enough non-web sources', () => {
    expect(isPortTurn(true, TARGET_AS)).toBe(true);
    expect(isPortTurn(false, TARGET_AS)).toBe(false); // an ordinary edit
    expect(isPortTurn(true, ['src/App.tsx', 'src/main.tsx', 'package.json'])).toBe(false); // a web app
  });
});

describe('the digest', () => {
  it('names a screen file\'s composables without their bodies', () => {
    const d = declarationsOf(HOME);
    expect(d).toEqual([
      '@Composable fun HomeScreen(viewModel: MainViewModel, onOpen: (String) -> Unit)',
      '@Composable private fun ExamCard(exam: Exam)',
    ]);
  });
  it('copies a data-model file whole, and never a file with behaviour', () => {
    expect(isModelFile(MODELS)).toBe(true);
    expect(isModelFile(HOME)).toBe(false);
    const text = portDigest([{ path: 'm/ExamModels.kt', content: MODELS }, { path: 's/HomeScreen.kt', content: HOME }]);
    expect(text).toContain('### m/ExamModels.kt (whole file)');
    expect(text).toContain('enum class Subject { MATH, SCIENCE, GK }');
    expect(text).toContain('### s/HomeScreen.kt\n- @Composable fun HomeScreen');
    expect(text).not.toContain('Text("Upcoming exams")');
  });
  it('stays within its bound and names what did not fit', () => {
    const big = Array.from({ length: 60 }, (_, i) => ({
      path: `s/Screen${i}Screen.kt`,
      content: Array.from({ length: 30 }, (_, j) => `fun helper${j}ForScreen${i}WithALongName(argumentOne: String, argumentTwo: Int)`).join('\n'),
    }));
    const text = portDigest(big, 70);
    expect(text.length).toBeLessThanOrEqual(PORT_DIGEST_MAX_CHARS + 2_000);
    expect(text).toMatch(/did not fit here/);
    expect(text).toMatch(/10 more original file\(s\) were not read/);
  });
  it('is empty when there is nothing to say', () => {
    expect(portDigest([])).toBe('');
  });
  it('reads only the foreign sources, skipping a failed or oversized read', async () => {
    const read = async (p: string) => (p.endsWith('HomeScreen.kt') ? HOME : p.endsWith('SettingsScreen.kt') ? null : p.endsWith('ExamModels.kt') ? MODELS : 'x'.repeat(40_000));
    const got = await collectPortSources(TARGET_AS, read);
    expect(got.map((g) => g.path.split('/').pop()).sort()).toEqual(['ExamModels.kt', 'HomeScreen.kt']);
  });
});

describe('a specialist is handed the original sources its task names', () => {
  it('a Kotlin, Java, Swift or Dart path is attached like a web file', () => {
    expect(filesNamedIn('Port app/src/main/java/com/example/ui/screens/HomeScreen.kt to src/screens/Home.tsx'))
      .toEqual(['app/src/main/java/com/example/ui/screens/HomeScreen.kt', 'src/screens/Home.tsx']);
    expect(filesNamedIn('see ios/App/ContentView.swift and lib/main.dart and src/main/java/a/B.java'))
      .toEqual(['ios/App/ContentView.swift', 'lib/main.dart', 'src/main/java/a/B.java']);
  });
});

describe('wiring', () => {
  it('the route builds the digest only on a port turn, prepends it, and hands it to every spawn', () => {
    expect(route).toMatch(/AGENTV3_PORT_DIGEST !== 'off' && isPortTurn\(buildOrderReadAsEdit !== null, fileTree\)/);
    expect(route).toContain('architectSystem = `${portDigestText}\\n\\n---\\n\\n${architectSystem}`;');
    expect(route).toContain('portDigest: () => portDigestText,');
    expect(subAgent).toContain("(() => { try { return deps.portDigest?.() ?? ''; } catch { return ''; } })(),");
  });
});

describe('the ETA of a port is sized by its project', () => {
  it('nine screens make nine modules, not one', () => {
    const base = complexityFromPrompt('Build app in this format');
    expect(base.moduleCount).toBe(1);
    const sized = projectSizedComplexity(base, [...TARGET_AS, 'app/src/main/java/com/example/ui/screens/ResultsScreen.kt',
      'app/src/main/java/com/example/ui/screens/MockTestScreen.kt', 'app/src/main/java/com/example/ui/screens/ProfileScreen.kt',
      'app/src/main/java/com/example/ui/screens/NotesScreen.kt', 'app/src/main/java/com/example/ui/screens/QuizScreen.kt']);
    expect(sized.moduleCount).toBe(9);
    expect(sized.featureCount).toBeGreaterThanOrEqual(6);
  });
  it('only raises, and a view-model is not a screen', () => {
    const big = { moduleCount: 12, featureCount: 20 };
    expect(projectSizedComplexity(big, ['a/HomeScreen.kt'])).toEqual(big);
    expect(projectSizedComplexity({ moduleCount: 1, featureCount: 1 }, ['a/MainViewModel.kt']).moduleCount).toBe(6);
  });
  it('the route applies it only to a turn the router sized by its project', () => {
    expect(route).toContain("const etaByProject = complexityDecision.source === 'workspace';");
    expect(route).toContain("projectSizedComplexity(complexityFromPrompt(planning.sizing), projectFilePaths)");
    expect(route).toContain("const etaFleetKey = etaByProject ? 'complex_app' :");
  });
});

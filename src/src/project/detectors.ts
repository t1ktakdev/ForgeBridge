export type ManifestEvidence = ReadonlyMap<string, string>;

export type RuntimeEvidence = {
  name: 'python' | 'rust' | 'go' | 'dotnet' | 'java';
  declaredRequirement: string | null;
  source: string;
  confidence: 'high' | 'medium';
};

export type EcosystemToolEvidence = {
  name: string;
  role:
    | 'package manager'
    | 'test runner'
    | 'build system'
    | 'lint'
    | 'formatter'
    | 'typechecker'
    | 'framework';
  source: string;
  confidence: 'high' | 'medium';
};

function capture(content: string | undefined, expression: RegExp): string | null {
  if (!content) return null;
  return expression.exec(content)?.[1]?.trim() ?? null;
}

function has(content: string | undefined, expression: RegExp): boolean {
  return Boolean(content && expression.test(content));
}

function addTool(
  tools: EcosystemToolEvidence[],
  seen: Set<string>,
  name: string,
  role: EcosystemToolEvidence['role'],
  source: string,
  confidence: EcosystemToolEvidence['confidence'] = 'medium',
): void {
  const key = `${name}\0${role}`;
  if (seen.has(key)) return;
  seen.add(key);
  tools.push({ name, role, source, confidence });
}

/** Parse only bounded, already-authorized manifest text. No repository code or config is executed. */
export function detectEcosystems(manifests: ManifestEvidence): {
  runtimes: RuntimeEvidence[];
  tools: EcosystemToolEvidence[];
} {
  const runtimes: RuntimeEvidence[] = [];
  const tools: EcosystemToolEvidence[] = [];
  const seenTools = new Set<string>();

  const pyproject = manifests.get('pyproject.toml');
  const requirements = manifests.get('requirements.txt');
  const pythonText = [pyproject, requirements].filter(Boolean).join('\n');
  if (pyproject || requirements) {
    runtimes.push({
      name: 'python',
      declaredRequirement: capture(pyproject, /^\s*requires-python\s*=\s*["']([^"']+)["']/imu),
      source: pyproject ? 'pyproject.toml' : 'requirements.txt',
      confidence: pyproject ? 'high' : 'medium',
    });
    if (manifests.has('uv.lock') || has(pyproject, /\buv\b/iu))
      addTool(
        tools,
        seenTools,
        'uv',
        'package manager',
        manifests.has('uv.lock') ? 'uv.lock' : 'pyproject.toml',
      );
    if (manifests.has('poetry.lock') || has(pyproject, /\btool\.poetry\b/iu))
      addTool(
        tools,
        seenTools,
        'poetry',
        'package manager',
        manifests.has('poetry.lock') ? 'poetry.lock' : 'pyproject.toml',
      );
    if (has(pythonText, /\bpytest\b/iu))
      addTool(
        tools,
        seenTools,
        'pytest',
        'test runner',
        pyproject ? 'pyproject.toml' : 'requirements.txt',
        'high',
      );
    if (has(pythonText, /\bruff\b/iu)) {
      addTool(
        tools,
        seenTools,
        'ruff',
        'lint',
        pyproject ? 'pyproject.toml' : 'requirements.txt',
        'high',
      );
      addTool(
        tools,
        seenTools,
        'ruff',
        'formatter',
        pyproject ? 'pyproject.toml' : 'requirements.txt',
      );
    }
    if (has(pythonText, /\bmypy\b/iu))
      addTool(
        tools,
        seenTools,
        'mypy',
        'typechecker',
        pyproject ? 'pyproject.toml' : 'requirements.txt',
        'high',
      );
    if (has(pythonText, /\bblack\b/iu))
      addTool(
        tools,
        seenTools,
        'black',
        'formatter',
        pyproject ? 'pyproject.toml' : 'requirements.txt',
        'high',
      );
    for (const framework of ['django', 'fastapi', 'flask']) {
      if (new RegExp(`\\b${framework}\\b`, 'iu').test(pythonText))
        addTool(
          tools,
          seenTools,
          framework,
          'framework',
          pyproject ? 'pyproject.toml' : 'requirements.txt',
          'high',
        );
    }
  }

  const cargo = manifests.get('Cargo.toml');
  if (cargo) {
    runtimes.push({
      name: 'rust',
      declaredRequirement: capture(cargo, /^\s*rust-version\s*=\s*["']([^"']+)["']/imu),
      source: 'Cargo.toml',
      confidence: 'high',
    });
    addTool(tools, seenTools, 'cargo', 'package manager', 'Cargo.toml', 'high');
    addTool(tools, seenTools, 'cargo test', 'test runner', 'Cargo.toml');
    addTool(tools, seenTools, 'cargo', 'build system', 'Cargo.toml');
  }

  const goMod = manifests.get('go.mod');
  if (goMod) {
    const version = capture(goMod, /^\s*go\s+([0-9]+(?:\.[0-9]+){1,2})\s*$/imu);
    runtimes.push({
      name: 'go',
      declaredRequirement: version ? `>=${version}` : null,
      source: 'go.mod',
      confidence: 'high',
    });
    addTool(tools, seenTools, 'go modules', 'package manager', 'go.mod', 'high');
    addTool(tools, seenTools, 'go test', 'test runner', 'go.mod');
    addTool(tools, seenTools, 'go', 'build system', 'go.mod');
    addTool(tools, seenTools, 'gofmt', 'formatter', 'go.mod');
  }

  const dotnetManifests = [...manifests.entries()].filter(([name]) =>
    /\.(?:csproj|fsproj)$/iu.test(name),
  );
  if (dotnetManifests.length > 0 || manifests.has('global.json')) {
    const combined = dotnetManifests.map(([, content]) => content).join('\n');
    const target = capture(combined, /<TargetFrameworks?>\s*([^<]+)\s*<\/TargetFrameworks?>/iu);
    const sdk = capture(manifests.get('global.json'), /"version"\s*:\s*"([^"]+)"/iu);
    runtimes.push({
      name: 'dotnet',
      declaredRequirement: target ?? (sdk ? `SDK ${sdk}` : null),
      source: target ? (dotnetManifests[0]?.[0] ?? 'project file') : 'global.json',
      confidence: target || sdk ? 'high' : 'medium',
    });
    addTool(tools, seenTools, 'NuGet', 'package manager', dotnetManifests[0]?.[0] ?? 'global.json');
    addTool(tools, seenTools, 'dotnet', 'build system', dotnetManifests[0]?.[0] ?? 'global.json');
    if (/\b(?:xunit|nunit|mstest)\b/iu.test(combined))
      addTool(
        tools,
        seenTools,
        /\bxunit\b/iu.test(combined) ? 'xUnit' : /\bnunit\b/iu.test(combined) ? 'NUnit' : 'MSTest',
        'test runner',
        dotnetManifests[0]?.[0] ?? 'project file',
        'high',
      );
  }

  const pom = manifests.get('pom.xml');
  const gradle = manifests.get('build.gradle') ?? manifests.get('build.gradle.kts');
  const javaText = pom ?? gradle;
  if (javaText) {
    const javaVersion =
      capture(javaText, /<java\.version>\s*([^<]+)\s*<\/java\.version>/iu) ??
      capture(
        javaText,
        /<maven\.compiler\.(?:release|source)>\s*([^<]+)\s*<\/maven\.compiler\.(?:release|source)>/iu,
      ) ??
      capture(javaText, /sourceCompatibility\s*=\s*["']?([^"'\s\r\n}]+)/iu);
    runtimes.push({
      name: 'java',
      declaredRequirement: javaVersion,
      source: pom
        ? 'pom.xml'
        : manifests.has('build.gradle.kts')
          ? 'build.gradle.kts'
          : 'build.gradle',
      confidence: javaVersion ? 'high' : 'medium',
    });
    addTool(
      tools,
      seenTools,
      pom ? 'Maven' : 'Gradle',
      'build system',
      pom ? 'pom.xml' : 'build.gradle',
      'high',
    );
    if (/\borg\.junit|\bjunit(?:-jupiter)?\b/iu.test(javaText))
      addTool(tools, seenTools, 'JUnit', 'test runner', pom ? 'pom.xml' : 'build.gradle', 'high');
    else if (/\btestng\b/iu.test(javaText))
      addTool(tools, seenTools, 'TestNG', 'test runner', pom ? 'pom.xml' : 'build.gradle', 'high');
  }

  return { runtimes, tools };
}

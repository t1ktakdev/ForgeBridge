import { describe, expect, it } from 'vitest';
import { detectEcosystems } from '../../src/project/detectors.js';

describe('project ecosystem detectors', () => {
  it('extracts bounded Python runtime and tooling evidence without executing configuration', () => {
    const result = detectEcosystems(
      new Map([
        [
          'pyproject.toml',
          `[project]\nrequires-python = ">=3.12"\ndependencies = ["fastapi", "pytest", "ruff", "mypy"]\n[tool.poetry]\nname = "fixture"\n`,
        ],
        ['poetry.lock', ''],
      ]),
    );
    expect(result.runtimes).toContainEqual(
      expect.objectContaining({
        name: 'python',
        declaredRequirement: '>=3.12',
        confidence: 'high',
      }),
    );
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'poetry', role: 'package manager' }),
        expect.objectContaining({ name: 'pytest', role: 'test runner' }),
        expect.objectContaining({ name: 'ruff', role: 'lint' }),
        expect.objectContaining({ name: 'mypy', role: 'typechecker' }),
        expect.objectContaining({ name: 'fastapi', role: 'framework' }),
      ]),
    );
  });

  it('extracts Rust and Go runtime/build evidence', () => {
    const result = detectEcosystems(
      new Map([
        ['Cargo.toml', `[package]\nname = "fixture"\nrust-version = "1.85"\n`],
        ['go.mod', 'module example.invalid/fixture\n\ngo 1.24\n'],
      ]),
    );
    expect(result.runtimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'rust', declaredRequirement: '1.85' }),
        expect.objectContaining({ name: 'go', declaredRequirement: '>=1.24' }),
      ]),
    );
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cargo', role: 'build system' }),
        expect.objectContaining({ name: 'cargo test', role: 'test runner' }),
        expect.objectContaining({ name: 'go', role: 'build system' }),
        expect.objectContaining({ name: 'go test', role: 'test runner' }),
      ]),
    );
  });

  it('extracts .NET and Java targets/test frameworks from project manifests', () => {
    const result = detectEcosystems(
      new Map([
        [
          'fixture.csproj',
          '<Project><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="xunit" Version="2.9.0" /></ItemGroup></Project>',
        ],
        [
          'pom.xml',
          '<project><properties><java.version>21</java.version></properties><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>',
        ],
      ]),
    );
    expect(result.runtimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'dotnet', declaredRequirement: 'net9.0' }),
        expect.objectContaining({ name: 'java', declaredRequirement: '21' }),
      ]),
    );
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'xUnit', role: 'test runner' }),
        expect.objectContaining({ name: 'Maven', role: 'build system' }),
        expect.objectContaining({ name: 'JUnit', role: 'test runner' }),
      ]),
    );
  });
});

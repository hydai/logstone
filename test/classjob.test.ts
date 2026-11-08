import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ClassJobParser } from '../src/parsers/classjob-parser';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('ClassJobParser on the Class/Job page', () => {
  test('reads the level and the name of a job from its own row', () => {
    const data = new ClassJobParser().parse(fixture('classjob-na.html'));

    expect(data.CombatJobs.Tank.Warrior).toMatchObject({ Level: '31', UnlockState: 'Warrior' });
    expect(data.GatheringJobs.Fisher).toMatchObject({ Level: '13', UnlockState: 'Fisher' });
  });
});

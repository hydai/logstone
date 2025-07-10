import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as classjobSelectors from '../lib/lodestone-css-selectors/profile/classjob.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
  multiple?: boolean;
}

interface JobData {
  Level?: string;
  UnlockState?: string;
  CurrentEXP?: string;
  MaxEXP?: string;
  Mettle?: string;
  Name?: string;
}

interface ClassJobData {
  CombatJobs: {
    Tank: Record<string, JobData>;
    Healer: Record<string, JobData>;
    MeleeDPS: Record<string, JobData>;
    RangedDPS: Record<string, JobData>;
    MagicalDPS: Record<string, JobData>;
  };
  CraftingJobs: Record<string, JobData>;
  GatheringJobs: Record<string, JobData>;
  SpecialContent: Record<string, JobData>;
}

export class ClassJobParser {
  private selectors: Record<string, any>;

  constructor() {
    this.selectors = classjobSelectors;
  }

  parse(html: string): ClassJobData {
    const document = parseDocument(html);
    const rawData = this.extractAllJobs(document);
    return this.organizeJobData(rawData);
  }

  private extractAllJobs(document: Document): Record<string, JobData> {
    const result: Record<string, JobData> = {};

    for (const jobName in this.selectors) {
      if (this.selectors.hasOwnProperty(jobName) && jobName !== 'default') {
        try {
          const jobData = this.extractJobData(document, this.selectors[jobName]);
          if (jobData && Object.keys(jobData).length > 0) {
            result[jobName] = jobData;
          }
        } catch (error) {
          console.error(`Error extracting ${jobName}:`, error);
        }
      }
    }

    return result;
  }

  private extractJobData(document: Document, jobSelectors: any): JobData {
    const jobData: JobData = {};

    if (jobSelectors.LEVEL) {
      const level = this.extractField(document, jobSelectors.LEVEL);
      if (level) jobData.Level = level;
    }

    if (jobSelectors.UNLOCKSTATE) {
      const unlockState = this.extractField(document, jobSelectors.UNLOCKSTATE);
      if (unlockState) jobData.UnlockState = unlockState;
    }

    if (jobSelectors.EXP) {
      const expData = this.extractField(document, jobSelectors.EXP);
      if (expData && typeof expData === 'object') {
        if (expData.CurrentEXP) jobData.CurrentEXP = expData.CurrentEXP;
        if (expData.MaxEXP) jobData.MaxEXP = expData.MaxEXP;
      }
    }

    if (jobSelectors.METTLE) {
      const mettleData = this.extractField(document, jobSelectors.METTLE);
      if (mettleData && typeof mettleData === 'object' && mettleData.Mettle) {
        jobData.Mettle = mettleData.Mettle;
      }
    }

    if (jobSelectors.NAME) {
      const name = this.extractField(document, jobSelectors.NAME);
      if (name) jobData.Name = name;
    }

    return jobData;
  }

  private extractField(document: Document, definition: SelectorDefinition): any {
    const element = this.querySelector(document, definition.selector);
    if (!element) return null;

    let value: string;
    if (definition.attribute) {
      value = this.getAttribute(element, definition.attribute) || '';
    } else {
      value = this.getTextContent(element);
    }

    if (definition.regex) {
      return this.applyRegex(value, definition.regex);
    }

    return value;
  }

  private querySelector(document: Document | Element, selector: string): Element | null {
    return this.findElement(document, selector);
  }

  private findElement(node: Document | Element, selector: string): Element | null {
    const parts = this.parseSelector(selector);
    let current: (Document | Element)[] = [node];

    for (const part of parts) {
      if (part.combinator === '>') {
        const next: Element[] = [];
        for (const el of current) {
          if ('children' in el) {
            for (const child of el.children) {
              if (child.type === 'tag' && this.matchesSelector(child as Element, part.selector)) {
                next.push(child as Element);
              }
            }
          }
        }
        current = next;
      } else {
        const next: Element[] = [];
        for (const el of current) {
          this.findDescendants(el, part.selector, next);
        }
        current = next;
      }
    }

    return current[0] as Element || null;
  }

  private parseSelector(selector: string): Array<{selector: string, combinator?: string}> {
    const parts: Array<{selector: string, combinator?: string}> = [];
    const regex = /\s*(>)?\s*([^>\s]+)/g;
    let match;

    while ((match = regex.exec(selector)) !== null) {
      parts.push({
        selector: match[2],
        combinator: match[1] || undefined
      });
    }

    return parts;
  }

  private findDescendants(node: Document | Element, selector: string, results: Element[]): void {
    if ('children' in node) {
      for (const child of node.children) {
        if (child.type === 'tag') {
          const element = child as Element;
          if (this.matchesSelector(element, selector)) {
            results.push(element);
          }
          this.findDescendants(element, selector, results);
        }
      }
    }
  }

  private matchesSelector(element: Element, selector: string): boolean {
    const pseudoMatch = selector.match(/^([^:]+)(:nth-child\((\d+)\))?$/);
    if (!pseudoMatch) return false;
    
    const [, baseSelector, , nthChild] = pseudoMatch;
    
    let matches = false;
    
    if (baseSelector.startsWith('.')) {
      const className = baseSelector.substring(1);
      matches = element.attribs?.class?.split(' ').includes(className) || false;
    } else if (baseSelector.startsWith('#')) {
      const id = baseSelector.substring(1);
      matches = element.attribs?.id === id;
    } else if (baseSelector.includes('[')) {
      const match = baseSelector.match(/^(\w+)?\[([^=]+)(?:="([^"]+)")?\]$/);
      if (match) {
        const [, tagName, attrName, attrValue] = match;
        if (tagName && element.name !== tagName) return false;
        if (attrValue) {
          matches = element.attribs?.[attrName] === attrValue;
        } else {
          matches = attrName in (element.attribs || {});
        }
      }
    } else if (baseSelector.includes('.')) {
      const [tagName, className] = baseSelector.split('.');
      matches = element.name === tagName && (element.attribs?.class?.split(' ').includes(className) || false);
    } else {
      matches = element.name === baseSelector;
    }
    
    if (matches && nthChild) {
      const index = parseInt(nthChild);
      const parent = element.parent;
      if (parent && 'children' in parent) {
        const siblings = parent.children.filter(child => child.type === 'tag');
        const elementIndex = siblings.indexOf(element) + 1;
        matches = elementIndex === index;
      }
    }
    
    return matches;
  }

  private getAttribute(element: Element, attribute: string): string | null {
    return element.attribs?.[attribute] || null;
  }

  private getTextContent(element: Element): string {
    let text = '';
    
    if (element.children) {
      for (const child of element.children) {
        if (child.type === 'text') {
          text += (child as any).data || '';
        } else if (child.type === 'tag') {
          text += this.getTextContent(child as Element);
        }
      }
    }
    
    return text.trim();
  }

  private applyRegex(value: string, regex: string): any {
    try {
      const namedGroupRegex = regex.replace(/\?P<(\w+)>/g, '?<$1>');
      const match = new RegExp(namedGroupRegex).exec(value);
      
      if (match) {
        if (match.groups && Object.keys(match.groups).length > 0) {
          return match.groups;
        }
        if (match[1] !== undefined) {
          return match[1];
        }
        return match[0];
      }
      return null;
    } catch (e) {
      console.error('Regex error:', e, 'for regex:', regex);
      return null;
    }
  }

  private organizeJobData(rawData: Record<string, JobData>): ClassJobData {
    const organized: ClassJobData = {
      CombatJobs: {
        Tank: {},
        Healer: {},
        MeleeDPS: {},
        RangedDPS: {},
        MagicalDPS: {}
      },
      CraftingJobs: {},
      GatheringJobs: {},
      SpecialContent: {}
    };

    const tankJobs = ['PALADIN', 'WARRIOR', 'DARKKNIGHT', 'GUNBREAKER'];
    const healerJobs = ['WHITEMAGE', 'SCHOLAR', 'ASTROLOGIAN', 'SAGE'];
    const meleeDPSJobs = ['MONK', 'DRAGOON', 'NINJA', 'SAMURAI', 'REAPER'];
    const rangedDPSJobs = ['BARD', 'MACHINIST', 'DANCER'];
    const magicalDPSJobs = ['BLACKMAGE', 'SUMMONER', 'REDMAGE', 'BLUEMAGE'];
    const craftingJobs = ['CARPENTER', 'BLACKSMITH', 'ARMORER', 'GOLDSMITH', 'LEATHERWORKER', 'WEAVER', 'ALCHEMIST', 'CULINARIAN'];
    const gatheringJobs = ['MINER', 'BOTANIST', 'FISHER'];
    const specialContent = ['EUREKA', 'BOZJA'];

    for (const [jobName, jobData] of Object.entries(rawData)) {
      const formattedName = this.formatJobName(jobName);

      if (tankJobs.includes(jobName)) {
        organized.CombatJobs.Tank[formattedName] = jobData;
      } else if (healerJobs.includes(jobName)) {
        organized.CombatJobs.Healer[formattedName] = jobData;
      } else if (meleeDPSJobs.includes(jobName)) {
        organized.CombatJobs.MeleeDPS[formattedName] = jobData;
      } else if (rangedDPSJobs.includes(jobName)) {
        organized.CombatJobs.RangedDPS[formattedName] = jobData;
      } else if (magicalDPSJobs.includes(jobName)) {
        organized.CombatJobs.MagicalDPS[formattedName] = jobData;
      } else if (craftingJobs.includes(jobName)) {
        organized.CraftingJobs[formattedName] = jobData;
      } else if (gatheringJobs.includes(jobName)) {
        organized.GatheringJobs[formattedName] = jobData;
      } else if (specialContent.includes(jobName)) {
        organized.SpecialContent[formattedName] = jobData;
      }
    }

    return organized;
  }

  private formatJobName(name: string): string {
    const jobNameMap: Record<string, string> = {
      'PALADIN': 'Paladin',
      'WARRIOR': 'Warrior',
      'DARKKNIGHT': 'DarkKnight',
      'GUNBREAKER': 'Gunbreaker',
      'WHITEMAGE': 'WhiteMage',
      'SCHOLAR': 'Scholar',
      'ASTROLOGIAN': 'Astrologian',
      'SAGE': 'Sage',
      'MONK': 'Monk',
      'DRAGOON': 'Dragoon',
      'NINJA': 'Ninja',
      'SAMURAI': 'Samurai',
      'REAPER': 'Reaper',
      'BARD': 'Bard',
      'MACHINIST': 'Machinist',
      'DANCER': 'Dancer',
      'BLACKMAGE': 'BlackMage',
      'SUMMONER': 'Summoner',
      'REDMAGE': 'RedMage',
      'BLUEMAGE': 'BlueMage',
      'CARPENTER': 'Carpenter',
      'BLACKSMITH': 'Blacksmith',
      'ARMORER': 'Armorer',
      'GOLDSMITH': 'Goldsmith',
      'LEATHERWORKER': 'Leatherworker',
      'WEAVER': 'Weaver',
      'ALCHEMIST': 'Alchemist',
      'CULINARIAN': 'Culinarian',
      'MINER': 'Miner',
      'BOTANIST': 'Botanist',
      'FISHER': 'Fisher',
      'EUREKA': 'Eureka',
      'BOZJA': 'Bozja'
    };

    return jobNameMap[name] || name;
  }
}
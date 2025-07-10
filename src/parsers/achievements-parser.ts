import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as achievementsSelectors from '../lib/lodestone-css-selectors/profile/achievements.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
  multiple?: boolean;
}

interface Achievement {
  ID: string;
  Name: string;
  Time: string;
}

interface AchievementsData {
  Achievements: Achievement[];
  TotalAchievements: number;
  AchievementPoints: string;
  Pagination?: {
    Page: number;
    PageTotal: number;
    PageNext: number | null;
    PagePrev: number | null;
  };
}

export class AchievementsParser {
  private selectors: Record<string, any>;

  constructor() {
    this.selectors = achievementsSelectors;
  }

  parse(html: string, currentPage: number = 1): AchievementsData {
    const document = parseDocument(html);
    
    // 提取成就列表
    const achievements = this.extractAchievements(document);
    
    // 提取總成就數
    const totalAchievements = this.extractTotalAchievements(document);
    
    // 提取成就點數
    const achievementPoints = this.extractAchievementPoints(document);
    
    // 提取分頁資訊
    const pagination = this.extractPagination(document, currentPage);

    return {
      Achievements: achievements,
      TotalAchievements: totalAchievements,
      AchievementPoints: achievementPoints,
      Pagination: pagination
    };
  }

  private extractAchievements(document: Document): Achievement[] {
    const achievements: Achievement[] = [];
    
    // 取得所有成就項目
    const entryElements = this.querySelectorAll(document, this.selectors.ENTRY.ROOT.selector);
    
    for (const element of entryElements) {
      const achievement = this.extractAchievementFromElement(element);
      if (achievement) {
        achievements.push(achievement);
      }
    }
    
    return achievements;
  }

  private extractAchievementFromElement(element: Element): Achievement | null {
    try {
      // 提取 ID
      const idElement = this.querySelector(element, this.selectors.ENTRY.ID.selector);
      const idHref = idElement ? this.getAttribute(idElement, 'href') : null;
      const idMatch = idHref ? this.applyRegex(idHref, this.selectors.ENTRY.ID.regex) : null;
      const id = idMatch?.ID || '';

      // 提取名稱
      const nameElement = this.querySelector(element, this.selectors.ENTRY.NAME.selector);
      const nameText = nameElement ? this.getTextContent(nameElement) : '';
      const nameMatch = this.applyRegex(nameText, this.selectors.ENTRY.NAME.regex);
      const name = (nameMatch?.Name || nameMatch?.NameDE || nameText).trim();

      // 提取時間
      const timeElement = this.querySelector(element, this.selectors.ENTRY.TIME.selector);
      const timeText = timeElement ? this.getTextContent(timeElement) : '';
      const timeMatch = this.applyRegex(timeText, this.selectors.ENTRY.TIME.regex);
      const timestamp = timeMatch?.Timestamp ? parseInt(timeMatch.Timestamp) * 1000 : 0;
      const time = timestamp ? new Date(timestamp).toISOString() : '';

      if (id && name) {
        return { ID: id, Name: name, Time: time };
      }
    } catch (error) {
      console.error('Error extracting achievement:', error);
    }
    
    return null;
  }

  private extractTotalAchievements(document: Document): number {
    const element = this.querySelector(document, this.selectors.TOTAL_ACHIEVEMENTS.selector);
    if (element) {
      const text = this.getTextContent(element);
      const match = this.applyRegex(text, this.selectors.TOTAL_ACHIEVEMENTS.regex);
      return match?.TotalAchievements ? parseInt(match.TotalAchievements) : 0;
    }
    return 0;
  }

  private extractAchievementPoints(document: Document): string {
    const element = this.querySelector(document, this.selectors.ACHIEVEMENT_POINTS.selector);
    return element ? this.getTextContent(element) : '0';
  }

  private extractPagination(document: Document, currentPage: number): AchievementsData['Pagination'] | undefined {
    const pageInfoElement = this.querySelector(document, this.selectors.PAGE_INFO.selector);
    if (!pageInfoElement) return undefined;

    const pageText = this.getTextContent(pageInfoElement);
    const pageMatch = this.applyRegex(pageText, this.selectors.PAGE_INFO.regex);
    
    if (pageMatch?.CurrentPage && pageMatch?.NumPages) {
      const page = parseInt(pageMatch.CurrentPage);
      const pageTotal = parseInt(pageMatch.NumPages);
      
      return {
        Page: page,
        PageTotal: pageTotal,
        PageNext: page < pageTotal ? page + 1 : null,
        PagePrev: page > 1 ? page - 1 : null
      };
    }
    
    return undefined;
  }

  // 以下是輔助方法，與 CharacterParser 類似
  private querySelector(node: Document | Element, selector: string): Element | null {
    return this.findElement(node, selector);
  }

  private querySelectorAll(node: Document | Element, selector: string): Element[] {
    const results: Element[] = [];
    const parts = this.parseSelector(selector);
    
    if (parts.length === 0) return results;
    
    const firstPart = parts[0];
    this.findDescendants(node, firstPart.selector, results);
    
    return results;
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
}
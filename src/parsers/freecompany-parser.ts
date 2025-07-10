import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as freecompanySelectors from '../lib/lodestone-css-selectors/freecompany/freecompany.json';
import * as focusSelectors from '../lib/lodestone-css-selectors/freecompany/focus.json';
import * as reputationSelectors from '../lib/lodestone-css-selectors/freecompany/reputation.json';
import * as seekingSelectors from '../lib/lodestone-css-selectors/freecompany/seeking.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
  multiple?: boolean;
}

interface FreeCompanyData {
  ID: string;
  Name: string;
  Tag: string;
  Slogan: string;
  CrestLayers: string[];
  Server: {
    World: string;
    DC: string;
  };
  GrandCompany: {
    Name: string;
    Rank: string;
  };
  ActiveState: string;
  Recruitment: string;
  ActiveMemberCount: string;
  Rank: string;
  Ranking?: {
    Weekly?: string;
    Monthly?: string;
  };
  Formed: string;
  Estate?: {
    Name?: string;
    Greeting?: string;
    Plot?: string;
  };
  Reputation?: any;
  Focus?: string[];
  Seeking?: string[];
}

export class FreeCompanyParser {
  private selectors: Record<string, any>;

  constructor() {
    this.selectors = {
      ...freecompanySelectors,
      ...focusSelectors,
      ...reputationSelectors,
      ...seekingSelectors
    };
  }

  parse(html: string): FreeCompanyData {
    const document = parseDocument(html);
    const result: any = {};

    // 解析所有基本欄位
    for (const field in freecompanySelectors) {
      if (freecompanySelectors.hasOwnProperty(field) && field !== 'default') {
        try {
          const value = this.extractField(document, (freecompanySelectors as any)[field]);
          if (value !== null && value !== undefined) {
            result[field] = value;
          }
        } catch (error) {
          console.error(`Error extracting field ${field}:`, error);
        }
      }
    }

    // 處理特殊欄位
    const processed = this.processSpecialFields(result);

    // 解析 Focus
    const focus = this.extractFocus(document);
    if (focus.length > 0) {
      processed.Focus = focus;
    }

    // 解析 Seeking
    const seeking = this.extractSeeking(document);
    if (seeking.length > 0) {
      processed.Seeking = seeking;
    }

    // 解析 Reputation
    const reputation = this.extractReputation(document);
    if (Object.keys(reputation).length > 0) {
      processed.Reputation = reputation;
    }

    return processed as FreeCompanyData;
  }

  private processSpecialFields(result: any): any {
    const processed: any = {};

    // 處理基本欄位
    processed.ID = result.ID?.ID || result.ID || '';
    processed.Name = result.NAME || '';
    processed.Tag = result.TAG || '';
    processed.Slogan = result.SLOGAN || '';

    // 處理 Crest Layers
    if (result.CREST_LAYERS) {
      processed.CrestLayers = [
        result.CREST_LAYERS.BOTTOM,
        result.CREST_LAYERS.MIDDLE,
        result.CREST_LAYERS.TOP
      ].filter(Boolean);
    }

    // 處理 Server
    if (result.SERVER) {
      processed.Server = result.SERVER;
    }

    // 處理 Grand Company
    if (result.GRAND_COMPANY) {
      processed.GrandCompany = result.GRAND_COMPANY;
    }

    // 處理其他欄位
    processed.ActiveState = result.ACTIVE_STATE?.ActiveState || result.ACTIVE_STATE || '';
    processed.Recruitment = result.RECRUITMENT?.ActiveState || result.RECRUITMENT || '';
    processed.ActiveMemberCount = result.ACTIVE_MEMBER_COUNT || '';
    processed.Rank = result.RANK || '';

    // 處理 Ranking
    if (result.RANKING) {
      processed.Ranking = {};
      if (result.RANKING.WEEKLY?.Rank) {
        processed.Ranking.Weekly = result.RANKING.WEEKLY.Rank;
      }
      if (result.RANKING.MONTHLY?.Rank) {
        processed.Ranking.Monthly = result.RANKING.MONTHLY.Rank;
      }
    }

    // 處理 Formed 時間戳
    if (result.FORMED?.Timestamp) {
      const timestamp = parseInt(result.FORMED.Timestamp) * 1000;
      processed.Formed = new Date(timestamp).toISOString();
    }

    // 處理 Estate
    if (result.ESTATE) {
      if (!result.ESTATE.NO_ESTATE) {
        processed.Estate = {};
        if (result.ESTATE.NAME) processed.Estate.Name = result.ESTATE.NAME;
        if (result.ESTATE.GREETING) processed.Estate.Greeting = result.ESTATE.GREETING;
        if (result.ESTATE.PLOT) processed.Estate.Plot = result.ESTATE.PLOT;
      }
    }

    return processed;
  }

  private extractFocus(document: Document): string[] {
    const focus: string[] = [];
    
    // focusSelectors 結構是扁平的，每個鍵是不同的 focus 類型
    for (const focusType in focusSelectors) {
      if (focusSelectors.hasOwnProperty(focusType) && focusType !== 'default' && focusType !== 'NOT_SPECIFIED') {
        const selector = (focusSelectors as any)[focusType];
        
        // 檢查每個 focus 項目的狀態
        if (selector.NAME && selector.STATUS) {
          const nameElement = this.querySelector(document, selector.NAME.selector);
          const statusElement = this.querySelector(document, selector.STATUS.selector);
          
          if (nameElement && statusElement) {
            const name = this.getTextContent(nameElement);
            const classAttr = this.getAttribute(statusElement, 'class') || '';
            
            // 如果沒有 'off' class，表示此項目是活躍的
            if (name && !classAttr.includes('freecompany__focus_icon--off')) {
              focus.push(name);
            }
          }
        }
      }
    }
    
    return focus;
  }

  private extractSeeking(document: Document): string[] {
    const seeking: string[] = [];
    
    // seekingSelectors 結構也是扁平的，每個鍵是不同的職業類型
    for (const roleType in seekingSelectors) {
      if (seekingSelectors.hasOwnProperty(roleType) && roleType !== 'default' && roleType !== 'NOT_SPECIFIED') {
        const selector = (seekingSelectors as any)[roleType];
        
        // 檢查每個職業的招募狀態
        if (selector.NAME && selector.STATUS) {
          const nameElement = this.querySelector(document, selector.NAME.selector);
          const statusElement = this.querySelector(document, selector.STATUS.selector);
          
          if (nameElement && statusElement) {
            const name = this.getTextContent(nameElement);
            const classAttr = this.getAttribute(statusElement, 'class') || '';
            
            // 如果沒有 'off' class，表示正在招募此職業
            if (name && !classAttr.includes('freecompany__role__icon--off')) {
              seeking.push(name);
            }
          }
        }
      }
    }
    
    return seeking;
  }

  private extractReputation(document: Document): any {
    const reputation: any = {};
    
    for (const gcName in reputationSelectors) {
      if (reputationSelectors.hasOwnProperty(gcName) && gcName !== 'default') {
        const value = this.extractField(document, (reputationSelectors as any)[gcName]);
        if (value) {
          reputation[gcName] = value;
        }
      }
    }
    
    return reputation;
  }

  // 以下是輔助方法，與其他 Parser 類似
  private extractField(document: Document, definition: SelectorDefinition | any): any {
    if (!definition) return null;

    if (this.isDefinition(definition)) {
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

    // 處理嵌套的選擇器
    const result: any = {};
    for (const key in definition) {
      if (definition.hasOwnProperty(key) && key !== 'default') {
        const value = this.extractField(document, definition[key]);
        if (value !== null && value !== undefined) {
          result[key] = value;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private isDefinition(definition: any): definition is SelectorDefinition {
    return definition && typeof definition.selector === 'string';
  }

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
    const pseudoMatch = selector.match(/^([^:]+)(:nth-child\((\d+)\)|:nth-of-type\((\d+)\))?$/);
    if (!pseudoMatch) return false;
    
    const [, baseSelector, , nthChild, nthOfType] = pseudoMatch;
    
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
    } else if (matches && nthOfType) {
      const index = parseInt(nthOfType);
      const parent = element.parent;
      if (parent && 'children' in parent) {
        const siblings = parent.children.filter(child => 
          child.type === 'tag' && (child as Element).name === element.name
        );
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
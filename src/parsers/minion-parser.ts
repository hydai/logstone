import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as minionSelectors from '../lib/lodestone-css-selectors/profile/minion.json';

interface MinionData {
  Name: string;
  Icon: string;
}

interface MinionsData {
  Minions: MinionData[];
  Total: number;
}

export class MinionParser {
  parse(html: string): MinionsData {
    const document = parseDocument(html);
    const minions: MinionData[] = [];

    // 解析寵物列表
    if (minionSelectors.MINIONS?.ROOT) {
      const elements = this.querySelectorAll(document, minionSelectors.MINIONS.ROOT.selector);
      
      for (const element of elements) {
        const minion = this.parseMinionEntry(element);
        if (minion) {
          minions.push(minion);
        }
      }
    }

    // 解析總數
    let total = minions.length;
    if (minionSelectors.TOTAL) {
      const totalElement = this.querySelector(document, minionSelectors.TOTAL.selector);
      if (totalElement) {
        const totalText = this.getTextContent(totalElement);
        const totalNumber = parseInt(totalText);
        if (!isNaN(totalNumber)) {
          total = totalNumber;
        }
      }
    }

    return {
      Minions: minions,
      Total: total
    };
  }

  private parseMinionEntry(element: Element): MinionData | null {
    const minion: any = {};

    // 解析 tooltip URL 來獲取名稱
    if (minionSelectors.MINIONS.TOOLTIP) {
      // 直接從 element 本身獲取 attribute
      const tooltipUrl = this.getAttribute(element, minionSelectors.MINIONS.TOOLTIP.attribute || 'data-tooltip_href') || '';
      if (tooltipUrl) {
        // 從 URL 中提取最後一部分作為 ID
        const parts = tooltipUrl.split('/');
        minion.Name = `Minion-${parts[parts.length - 1]}`;
      }
    }

    // 解析圖標
    if (minionSelectors.MINIONS.ICON) {
      const iconElement = this.querySelector(element, minionSelectors.MINIONS.ICON.selector);
      if (iconElement) {
        minion.Icon = this.getAttribute(iconElement, minionSelectors.MINIONS.ICON.attribute || 'src') || '';
      }
    }

    // 確保有基本資料才返回
    if (minion.Name && minion.Icon) {
      return minion as MinionData;
    }

    return null;
  }

  // 以下是輔助方法，與其他 Parser 類似
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
}
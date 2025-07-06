import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as characterSelectors from '../lib/lodestone-css-selectors/profile/character.json';
import * as attributesSelectors from '../lib/lodestone-css-selectors/profile/attributes.json';
import * as gearsetSelectors from '../lib/lodestone-css-selectors/profile/gearset.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
  multiple?: boolean;
}

export class CharacterParser {
  private selectors: Record<string, any>;

  constructor() {
    this.selectors = {
      ...characterSelectors,
      ...attributesSelectors,
      ...gearsetSelectors
    };
  }

  parse(html: string): any {
    const document = parseDocument(html);
    const result: any = {};

    // 解析主要欄位
    const fieldsToExtract = [
      'NAME',
      'SERVER',
      'TITLE',
      'RACE',
      'GENDER',
      'NAMEDAY',
      'GUARDIAN',
      'CITYSTATE',
      'GRANDCOMPANY',
      'FREECOMPANY',
      'BIOGRAPHYTEXT'
    ];

    for (const field of fieldsToExtract) {
      if (this.selectors[field]) {
        const value = this.extractField(document, this.selectors[field]);
        if (value !== null) {
          const fieldName = this.formatFieldName(field);
          result[fieldName] = value;
        }
      }
    }

    return result;
  }

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
        if (value !== null) {
          result[this.formatFieldName(key)] = value;
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  private isDefinition(definition: any): definition is SelectorDefinition {
    return definition && typeof definition.selector === 'string';
  }

  private querySelector(document: Document | Element, selector: string): Element | null {
    // 簡化的選擇器實現
    // 這裡需要實現基本的 CSS 選擇器邏輯
    return this.findElement(document, selector);
  }

  private findElement(node: Document | Element, selector: string): Element | null {
    // 基本的選擇器解析
    const parts = selector.split(' ');
    let current: (Document | Element)[] = [node];

    for (const part of parts) {
      const next: Element[] = [];
      
      for (const el of current) {
        if ('children' in el) {
          for (const child of el.children) {
            if (this.matchesSelector(child, part)) {
              next.push(child as Element);
            }
          }
        }
      }
      
      current = next;
    }

    return current[0] as Element || null;
  }

  private matchesSelector(element: Element, selector: string): boolean {
    if (selector.startsWith('.')) {
      // Class selector
      const className = selector.substring(1);
      return element.attribs?.class?.split(' ').includes(className) || false;
    } else if (selector.startsWith('#')) {
      // ID selector
      const id = selector.substring(1);
      return element.attribs?.id === id;
    } else if (selector.includes('[')) {
      // Attribute selector
      const match = selector.match(/^(\w+)?\[([^=]+)(?:="([^"]+)")?\]$/);
      if (match) {
        const [, tagName, attrName, attrValue] = match;
        if (tagName && element.name !== tagName) return false;
        if (attrValue) {
          return element.attribs?.[attrName] === attrValue;
        }
        return attrName in (element.attribs || {});
      }
    } else {
      // Tag selector
      return element.name === selector;
    }
    return false;
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
      // 簡化的 regex 處理
      const match = new RegExp(regex).exec(value);
      if (match && match.groups) {
        return match.groups;
      }
      return match?.[1] || null;
    } catch (e) {
      return null;
    }
  }

  private formatFieldName(name: string): string {
    return name.split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')
      .replace(/Id/g, 'ID');
  }
}
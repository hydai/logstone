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
    let result: any = {};

    // Skip problematic selectors that are too broad
    const skipFields = ['CLASSJOB_ICONS'];
    
    // 解析所有可用的欄位
    for (const field in this.selectors) {
      if (this.selectors.hasOwnProperty(field) && !skipFields.includes(field)) {
        try {
          const value = this.extractField(document, this.selectors[field]);
          if (value !== null && this.isValidValue(value)) {
            const fieldName = this.formatFieldName(field);
            result[fieldName] = value;
          }
        } catch (error) {
          console.error(`Error extracting field ${field}:`, error);
        }
      }
    }

    // 特殊處理某些複雜的欄位
    result = this.processSpecialFields(result);

    return result;
  }

  private processSpecialFields(result: any): any {
    // 處理 Free Company
    if (result.FreeCompany?.Name?.ID) {
      // 根據現有的選擇器，我們只能取得 ID
      result.FreeCompany = {
        ID: result.FreeCompany.Name.ID,
        Crest: [
          result.FreeCompany.IconLayers?.Bottom || null,
          result.FreeCompany.IconLayers?.Middle || null,
          result.FreeCompany.IconLayers?.Top || null
        ].filter(Boolean)
      };
    }

    // 處理 PvP Team  
    if (result.PvpTeam?.Name?.ID) {
      // 根據現有的選擇器，我們只能取得 ID
      result.PvPTeam = {
        ID: result.PvpTeam.Name.ID,
        Crest: [
          result.PvpTeam.IconLayers?.Bottom || null,
          result.PvpTeam.IconLayers?.Middle || null,
          result.PvpTeam.IconLayers?.Top || null
        ].filter(Boolean)
      };
      delete result.PvpTeam; // 移除舊的欄位名稱
    }

    // 處理 Guardian Deity - 保持原有結構
    // 處理 Town - 保持原有結構

    return result;
  }

  private isValidValue(value: any): boolean {
    // Filter out invalid or overly large results
    if (Array.isArray(value)) {
      // Skip arrays with too many items (likely incorrect selector)
      if (value.length > 50) return false;
      // Skip arrays with only text content from navigation
      if (value.length > 0 && typeof value[0] === 'string' && 
          value.some(v => v.includes('News') || v.includes('Community') || v.includes('Play Guide'))) {
        return false;
      }
    }
    return true;
  }

  private extractField(document: Document, definition: SelectorDefinition | any): any {
    if (!definition) return null;

    if (this.isDefinition(definition)) {
      // Handle multiple elements
      if (definition.multiple) {
        const elements = this.querySelectorAll(document, definition.selector);
        return elements.map(element => {
          if (definition.attribute) {
            return this.getAttribute(element, definition.attribute) || '';
          } else {
            return this.getTextContent(element);
          }
        });
      }
      
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
        if (value !== null && value !== undefined && 
            (typeof value !== 'object' || Object.keys(value).length > 0)) {
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
    return this.findElement(document, selector);
  }

  private querySelectorAll(document: Document | Element, selector: string): Element[] {
    const results: Element[] = [];
    const parts = this.parseSelector(selector);
    
    if (parts.length === 0) return results;
    
    // For now, only handle simple selectors for multiple elements
    const firstPart = parts[0];
    this.findDescendants(document, firstPart.selector, results);
    
    return results;
  }

  private findElement(node: Document | Element, selector: string): Element | null {
    // 處理複雜的選擇器
    const parts = this.parseSelector(selector);
    let current: (Document | Element)[] = [node];

    for (const part of parts) {
      if (part.combinator === '>') {
        // Direct child selector
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
        // Descendant selector
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
          // Recursive search
          this.findDescendants(element, selector, results);
        }
      }
    }
  }

  private matchesSelector(element: Element, selector: string): boolean {
    // Handle pseudo-selectors
    const pseudoMatch = selector.match(/^([^:]+)(:nth-child\((\d+)\))?$/);
    if (!pseudoMatch) return false;
    
    const [, baseSelector, , nthChild] = pseudoMatch;
    
    // First check the base selector
    let matches = false;
    
    if (baseSelector.startsWith('.')) {
      // Class selector
      const className = baseSelector.substring(1);
      matches = element.attribs?.class?.split(' ').includes(className) || false;
    } else if (baseSelector.startsWith('#')) {
      // ID selector
      const id = baseSelector.substring(1);
      matches = element.attribs?.id === id;
    } else if (baseSelector.includes('[')) {
      // Attribute selector
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
      // Tag with class (e.g., div.className)
      const [tagName, className] = baseSelector.split('.');
      matches = element.name === tagName && (element.attribs?.class?.split(' ').includes(className) || false);
    } else {
      // Tag selector
      matches = element.name === baseSelector;
    }
    
    // Handle nth-child if present
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
      // Handle named groups in regex
      const namedGroupRegex = regex.replace(/\?P<(\w+)>/g, '?<$1>');
      const match = new RegExp(namedGroupRegex).exec(value);
      
      if (match) {
        // If there are named groups, return them as an object
        if (match.groups && Object.keys(match.groups).length > 0) {
          return match.groups;
        }
        // If there's a capturing group, return it
        if (match[1] !== undefined) {
          return match[1];
        }
        // Otherwise return the full match
        return match[0];
      }
      return null;
    } catch (e) {
      console.error('Regex error:', e, 'for regex:', regex);
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
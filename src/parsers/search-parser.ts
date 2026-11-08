import { parseDocument } from 'htmlparser2';
import { Element, Document, isTag } from 'domhandler';
import { ParseError } from '../lib/http';
import * as searchSelectors from '../lib/lodestone-css-selectors/search/character.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
}

export interface CharacterSearchResult {
  ID: number;
  Name: string;
  World: string;
  DC: string;
  Avatar: string;
  FreeCompany: {
    ID: string;
    Name: string;
  } | null;
}

export interface CharacterSearchData {
  Results: CharacterSearchResult[];
  Pagination: {
    Page: number;
    PageTotal: number;
    Total: number;
  };
}

export class CharacterSearchParser {
  parse(html: string): CharacterSearchData {
    const document = parseDocument(html);

    // The window wraps the content of the Lodestone pages these parsers read. A page without it is an
    // error page, a maintenance notice or a layout these selectors do not know, and "nobody found" would
    // be a wrong answer.
    if (!this.querySelector(document, searchSelectors.ROOT.selector)) {
      throw new ParseError('The page has no .ldst__window, so it is not a Lodestone search page');
    }

    const results = this.extractResults(document);

    // An empty list is an answer only when the page says that nobody matches: with its notice
    // (.parts__zero), or with a total of 0. Nobody found is then the first of no pages, with a total
    // of 0, whatever else the page states. A page with the window, no row the parser can read and
    // neither of these is a layout it does not know: an empty list would tell every player that
    // nobody has that name.
    if (results.length === 0) {
      const notice = this.querySelector(document, searchSelectors.NO_RESULTS_FOUND.selector) !== null;
      const total = this.toNumber(this.extractField(document, searchSelectors.TOTAL)?.Total);
      if (!notice && total !== 0) {
        throw new ParseError(
          'The page has no row the parser can read, does not say that nobody matches and has no total of 0'
        );
      }
      return { Results: [], Pagination: { Page: 1, PageTotal: 0, Total: 0 } };
    }

    return {
      Results: results,
      Pagination: this.extractPagination(document, results.length)
    };
  }

  private extractResults(document: Document): CharacterSearchResult[] {
    const results: CharacterSearchResult[] = [];

    for (const element of this.querySelectorAll(document, searchSelectors.ENTRY.ROOT.selector)) {
      const result = this.extractResult(element);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  // A row is listed only with a character ID and a name: without them there is nobody to show or to look up.
  private extractResult(element: Element): CharacterSearchResult | null {
    const entry = searchSelectors.ENTRY;

    const id = Number(this.extractField(element, entry.ID)?.ID);
    const name = this.extractField(element, entry.NAME) || '';
    if (!Number.isSafeInteger(id) || id <= 0 || !name) {
      return null;
    }

    const server = this.extractField(element, entry.SERVER);

    // The company ID stays text: it has 19 digits, more than a number holds exactly.
    // The link is the company's own, next to the link of the character, so a character without one has no company.
    const companyId: string | undefined = this.extractField(element, entry.FREE_COMPANY.ID)?.ID;
    const freeCompany = companyId
      ? { ID: companyId, Name: this.extractField(element, entry.FREE_COMPANY.NAME) || '' }
      : null;

    return {
      ID: id,
      Name: name,
      World: server?.World ?? '',
      DC: server?.DC ?? '',
      Avatar: this.extractField(element, entry.AVATAR) || '',
      FreeCompany: freeCompany
    };
  }

  // The pager says "Page 1 of 20" on the English site and "1ページ / 20ページ" on the Japanese one, and
  // the total says "1000 Total" or "1000 件": the regexes take the numbers and leave the words alone. A
  // total may be written with thousands separators ("1,000"), and toNumber reads those whole.
  // This is the pagination of a page that lists somebody: without a pager it is the first of one page,
  // and without a total, the total is the number of rows listed.
  private extractPagination(document: Document, rows: number): CharacterSearchData['Pagination'] {
    const pages = this.extractField(document, searchSelectors.PAGE_INFO);
    const total = this.extractField(document, searchSelectors.TOTAL);

    return {
      Page: this.toNumber(pages?.CurrentPage) ?? 1,
      PageTotal: this.toNumber(pages?.NumPages) ?? 1,
      Total: this.toNumber(total?.Total) ?? rows
    };
  }

  private toNumber(value: unknown): number | null {
    const number = typeof value === 'string' ? Number.parseInt(value.replaceAll(',', ''), 10) : NaN;
    return Number.isNaN(number) ? null : number;
  }

  // What a selector definition finds below the node: the text, or the attribute, of the first element
  // it matches, put through its regex when it has one. Nothing found is null.
  private extractField(node: Document | Element, definition: SelectorDefinition): any {
    const element = this.querySelector(node, definition.selector);
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
              // isTag, not type === 'tag': htmlparser2 gives <script> and <style> a type of their own.
              if (isTag(child) && this.matchesSelector(child as Element, part.selector)) {
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
        if (isTag(child)) {
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

import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import { ParseError } from '../lib/http';
import { activeJobKey } from '../lib/job-icons';
import * as characterSelectors from '../lib/lodestone-css-selectors/profile/character.json';
import * as attributesSelectors from '../lib/lodestone-css-selectors/profile/attributes.json';

interface SelectorDefinition {
  selector: string;
  attribute?: string;
  regex?: string;
  multiple?: boolean;
}

// The slots of the gear tab in the order the answer lists them, each with the id of its box on the page
// (div.icon-c--<id>.ic_reflection_box). The page numbers the boxes from 0 and has no 5 (the belt is gone
// from the game), and calls the glasses "glasses". Any other box, like the icons next to the headings
// (i.icon-c--title), is not a slot.
const GEAR_SLOTS = [
  ['MainHand', '0'],
  ['OffHand', '1'],
  ['Head', '2'],
  ['Body', '3'],
  ['Hands', '4'],
  ['Legs', '6'],
  ['Feet', '7'],
  ['Earrings', '8'],
  ['Necklace', '9'],
  ['Bracelets', '10'],
  ['Ring1', '11'],
  ['Ring2', '12'],
  ['SoulCrystal', '13'],
  ['Facewear', 'glasses']
] as const;

type GearSlot = (typeof GEAR_SLOTS)[number][0];

// What the page shows of a slot: the icon of the item and the colour of each dye coat that has paint. The
// name and the item level load later from a tooltip, so the page does not have them.
interface GearItem {
  Slot: GearSlot;
  Icon: string;
  Dyes: string[];
}

export class CharacterParser {
  private selectors: Record<string, any>;

  constructor() {
    this.selectors = {
      ...characterSelectors,
      ...attributesSelectors
    };
  }

  parse(html: string): any {
    const document = parseDocument(html);
    let result: any = {};

    // Skip problematic selectors that are too broad, and "default": a bundled JSON file also exports itself
    // under that name, which read as a field would answer the last selector file's fields a second time
    const skipFields = ['CLASSJOB_ICONS', 'default'];

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

    // Every character page shows the name, the private ones too. A page without it is a layout the
    // selectors do not know, or another page: answering it would keep a nameless character for a day.
    if (!result.Name) {
      throw new ParseError('The page has no character name, so it is not a character page the parser knows');
    }

    // 特殊處理某些複雜的欄位
    result = this.processSpecialFields(result, document);

    return result;
  }

  private processSpecialFields(result: any, document: Document): any {
    // Free Company: the selector only reads the ID out of the link's href, the name is the
    // text of that same link. A character without a company has none of it, which is null.
    if (result.FreeCompany?.Name?.ID) {
      result.FreeCompany = {
        ID: result.FreeCompany.Name.ID,
        Name: this.extractFreeCompanyName(document),
        Crest: [
          result.FreeCompany.IconLayers?.Bottom || null,
          result.FreeCompany.IconLayers?.Middle || null,
          result.FreeCompany.IconLayers?.Top || null
        ].filter(Boolean)
      };
    } else {
      result.FreeCompany = null;
    }

    // Active job: the icon, the level and the job the icon belongs to. ActiveClassjob and
    // ActiveClassjobLevel stay as they are because the website still reads them.
    const icon = typeof result.ActiveClassjob === 'string' && result.ActiveClassjob ? result.ActiveClassjob : null;
    result.ActiveClassJob = {
      Key: activeJobKey(icon),
      Level: this.parseLevel(result.ActiveClassjobLevel),
      Icon: icon
    };

    // The bio is the one text where a player's own line breaks matter, so <br> becomes "\n"
    // here instead of being dropped as in the other texts.
    const bioSelector = this.selectors.BIO?.selector;
    const bio = bioSelector ? this.querySelector(document, bioSelector) : null;
    if (bio) {
      result.Bio = this.getTextWithLineBreaks(bio).trim();
    }

    // Gear: the icon and the dyes of each slot. The page has no item names (they load from a tooltip),
    // so there are none to read.
    result.Gear = this.extractGear(document);

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

  // Every slot that shows an icon, in the order of GEAR_SLOTS whatever the order of the page. A slot with
  // nothing in it is an empty box, and a slot the page does not have is not there, so both are left out and
  // a character with nothing equipped has an empty list. A slot is listed once, from its first box.
  private extractGear(document: Document): GearItem[] {
    const boxes = this.querySelectorAll(document, 'div.ic_reflection_box');

    const gear: GearItem[] = [];
    for (const [slot, id] of GEAR_SLOTS) {
      const box = boxes.find((candidate) => this.gearBoxId(candidate) === id);
      if (!box) continue;

      const image = this.querySelector(box, 'img.character__item_icon__img');
      const icon = image ? this.getAttribute(image, 'src') : null;
      if (!icon) continue;

      gear.push({ Slot: slot, Icon: icon, Dyes: this.extractDyes(box) });
    }
    return gear;
  }

  // The id of a box, which is what follows icon-c-- in its class ("icon-c--0 ic_reflection_box ...").
  private gearBoxId(box: Element): string | null {
    const prefix = 'icon-c--';
    const name = (box.attribs?.class ?? '').split(/\s+/).find((className) => className.startsWith(prefix));
    return name === undefined ? null : name.slice(prefix.length);
  }

  // The colour of each dye coat that has paint, the first coat and then the second (the page writes them in
  // that order). A coat is div.mirage_staining; it has paint when it is also painted_cover, and then its
  // style gives the colour. A coat that is not painted ("no_paint"), or sits on an item that cannot be dyed
  // ("unpaitable", spelt so on the page), has no dye, and neither has a painted one whose style is not a
  // #rrggbb colour.
  private extractDyes(box: Element): string[] {
    const dyes: string[] = [];
    for (const coat of this.querySelectorAll(box, 'div.mirage_staining')) {
      if (!this.hasClass(coat, 'painted_cover')) continue;

      const color = /background-color:\s*(#[0-9a-f]{6})\b/i.exec(coat.attribs?.style ?? '');
      if (color) dyes.push(color[1].toLowerCase());
    }
    return dyes;
  }

  private hasClass(element: Element, className: string): boolean {
    return (element.attribs?.class ?? '').split(/\s+/).includes(className);
  }

  // The text of the link whose href holds the company ID (FREE_COMPANY.NAME in character.json).
  private extractFreeCompanyName(document: Document): string {
    const selector = this.selectors.FREE_COMPANY?.NAME?.selector;
    const link = selector ? this.querySelector(document, selector) : null;
    return link ? this.getTextContent(link) : '';
  }

  // The level is the first number on the class line, which the Japanese site continues with the
  // name of the job ("LEVEL 100 吟遊詩人"). `level` is what the selector found: an object with a
  // Level, or nothing when the line did not match.
  private parseLevel(level: any): number | null {
    const text = typeof level === 'object' && level !== null ? level.Level : level;
    const digits = /\d+/.exec(String(text ?? ''));
    return digits ? Number(digits[0]) : null;
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

  // Like getTextContent, but a <br> is a line break, and nothing is trimmed on the way.
  private getTextWithLineBreaks(element: Element): string {
    let text = '';

    for (const child of element.children) {
      if (child.type === 'text') {
        text += (child as any).data || '';
      } else if (child.type === 'tag') {
        const tag = child as Element;
        text += tag.name === 'br' ? '\n' : this.getTextWithLineBreaks(tag);
      }
    }

    return text;
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

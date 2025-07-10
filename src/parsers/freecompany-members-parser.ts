import { parseDocument } from 'htmlparser2';
import { Element, Document } from 'domhandler';
import * as membersSelectors from '../lib/lodestone-css-selectors/freecompany/members.json';

interface MemberData {
  Avatar: string;
  ID: string;
  Name: string;
  FCRank: string;
  FCRankIcon: string;
  Rank: string;
  RankIcon: string;
  Server: {
    World: string;
    DC: string;
  };
}

interface FreeCompanyMembersData {
  Members: MemberData[];
  Pagination: {
    Page: number;
    PageTotal: number;
    PageNext?: number;
    PagePrev?: number;
  };
}

export class FreeCompanyMembersParser {
  parse(html: string, currentPage: number = 1): FreeCompanyMembersData {
    const document = parseDocument(html);
    const members: MemberData[] = [];

    // 解析成員列表
    if (membersSelectors.ENTRY?.ROOT) {
      const elements = this.querySelectorAll(document, membersSelectors.ENTRY.ROOT.selector);
      
      for (const element of elements) {
        const member = this.parseMemberEntry(element);
        if (member) {
          members.push(member);
        }
      }
    }

    // 解析分頁資訊
    const pagination = this.parsePagination(document, currentPage);

    return {
      Members: members,
      Pagination: pagination
    };
  }

  private parseMemberEntry(element: Element): MemberData | null {
    const member: any = {};

    // 解析頭像
    if (membersSelectors.ENTRY.AVATAR) {
      const avatarElement = this.querySelector(element, membersSelectors.ENTRY.AVATAR.selector);
      if (avatarElement) {
        member.Avatar = this.getAttribute(avatarElement, membersSelectors.ENTRY.AVATAR.attribute || 'src') || '';
      }
    }

    // 解析 ID
    if (membersSelectors.ENTRY.ID) {
      const idElement = this.querySelector(element, membersSelectors.ENTRY.ID.selector);
      if (idElement) {
        const href = this.getAttribute(idElement, membersSelectors.ENTRY.ID.attribute || 'href') || '';
        if (membersSelectors.ENTRY.ID.regex) {
          const match = this.applyRegex(href, membersSelectors.ENTRY.ID.regex);
          if (match && match.ID) {
            member.ID = match.ID;
          }
        }
      }
    }

    // 解析名字
    if (membersSelectors.ENTRY.NAME) {
      const nameElement = this.querySelector(element, membersSelectors.ENTRY.NAME.selector);
      if (nameElement) {
        member.Name = this.getTextContent(nameElement);
      }
    }

    // 解析 FC 階級
    if (membersSelectors.ENTRY.FC_RANK) {
      const fcRankElement = this.querySelector(element, membersSelectors.ENTRY.FC_RANK.selector);
      if (fcRankElement) {
        member.FCRank = this.getTextContent(fcRankElement);
      }
    }

    // 解析 FC 階級圖標
    if (membersSelectors.ENTRY.FC_RANK_ICON) {
      const fcRankIconElement = this.querySelector(element, membersSelectors.ENTRY.FC_RANK_ICON.selector);
      if (fcRankIconElement) {
        member.FCRankIcon = this.getAttribute(fcRankIconElement, membersSelectors.ENTRY.FC_RANK_ICON.attribute || 'src') || '';
      }
    }

    // 解析玩家階級
    if (membersSelectors.ENTRY.RANK) {
      const rankElement = this.querySelector(element, membersSelectors.ENTRY.RANK.selector);
      if (rankElement) {
        const tooltipData = this.getAttribute(rankElement, membersSelectors.ENTRY.RANK.attribute || 'data-tooltip') || '';
        if (membersSelectors.ENTRY.RANK.regex) {
          const match = this.applyRegex(tooltipData, membersSelectors.ENTRY.RANK.regex);
          if (match && match.RankName) {
            member.Rank = match.RankName;
          }
        }
      }
    }

    // 解析玩家階級圖標
    if (membersSelectors.ENTRY.RANK_ICON) {
      const rankIconElement = this.querySelector(element, membersSelectors.ENTRY.RANK_ICON.selector);
      if (rankIconElement) {
        member.RankIcon = this.getAttribute(rankIconElement, membersSelectors.ENTRY.RANK_ICON.attribute || 'src') || '';
      }
    }

    // 解析伺服器
    if (membersSelectors.ENTRY.SERVER) {
      const serverElement = this.querySelector(element, membersSelectors.ENTRY.SERVER.selector);
      if (serverElement) {
        const serverText = this.getTextContent(serverElement);
        if (membersSelectors.ENTRY.SERVER.regex) {
          const match = this.applyRegex(serverText, membersSelectors.ENTRY.SERVER.regex);
          if (match && match.World && match.DC) {
            member.Server = {
              World: match.World,
              DC: match.DC
            };
          }
        }
      }
    }

    // 確保有基本資料才返回
    if (member.ID && member.Name) {
      return member as MemberData;
    }

    return null;
  }

  private parsePagination(document: Document, currentPage: number): any {
    const pagination: any = {
      Page: currentPage,
      PageTotal: 1
    };

    // 解析頁面資訊
    if (membersSelectors.PAGE_INFO) {
      const pageInfoElement = this.querySelector(document, membersSelectors.PAGE_INFO.selector);
      if (pageInfoElement) {
        const pageText = this.getTextContent(pageInfoElement);
        if (membersSelectors.PAGE_INFO.regex) {
          const match = this.applyRegex(pageText, membersSelectors.PAGE_INFO.regex);
          if (match) {
            pagination.Page = parseInt(match.CurrentPage) || currentPage;
            pagination.PageTotal = parseInt(match.NumPages) || 1;
          }
        }
      }
    }

    // 計算上一頁和下一頁
    if (pagination.Page > 1) {
      pagination.PagePrev = pagination.Page - 1;
    }
    if (pagination.Page < pagination.PageTotal) {
      pagination.PageNext = pagination.Page + 1;
    }

    return pagination;
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
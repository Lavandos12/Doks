import { describe, it, expect } from 'vitest';
import {
  classifyInterface,
  listOverlayInterfaces,
  detectPreferredMeshIp
} from '../../agent/src/network.js';
import {
  findMagneticTargetPort,
  buildBezierEdgePath,
  getPortCoordinates,
  type BoxNode
} from '../../web/src/utils/connectorGeometry.js';

describe('V1 Multi-VPN Filtering & Geometric Magnetic Connectors', () => {
  describe('Multi-VPN Interface Classification & Proxy TUN Filtering', () => {
    it('correctly identifies Radmin VPN across arbitrary localized Windows adapter names via 26.0.0.0/8', () => {
      // Localized Russian/English Windows adapter names
      expect(classifyInterface('Ethernet 2', '26.15.82.100')).toBe('radmin');
      expect(classifyInterface('Сетевое подключение', '26.44.12.3')).toBe('radmin');
      expect(classifyInterface('Radmin VPN Adapter', '26.1.2.3')).toBe('radmin');
    });

    it('strictly classifies proxy TUN fake subnets (Hiddify, sing-box, Clash, Nekoray) as vpn-tun', () => {
      // sing-tun / Hiddify 172.19.0.x
      expect(classifyInterface('sing-tun', '172.19.0.1')).toBe('vpn-tun');
      expect(classifyInterface('sing-box', '172.19.0.2')).toBe('vpn-tun');
      expect(classifyInterface('hiddify', '172.19.0.5')).toBe('vpn-tun');

      // FakeIP 198.18.0.0/15 standard clash/sing-box range
      expect(classifyInterface('AnyAdapter', '198.18.0.1')).toBe('vpn-tun');
      expect(classifyInterface('Adapter', '198.19.100.50')).toBe('vpn-tun');

      // Wintun / Nekoray / Clash
      expect(classifyInterface('nekoray-tun', '10.0.8.2')).toBe('vpn-tun');
      expect(classifyInterface('clash-tun', '10.0.4.1')).toBe('vpn-tun');
      expect(classifyInterface('wintun', '10.255.0.1')).toBe('vpn-tun');
    });

    it('identifies Tailscale, ZeroTier, and standard LAN networks', () => {
      // Tailscale CGNAT 100.64.0.0/10
      expect(classifyInterface('Tailscale', '100.85.12.34')).toBe('tailscale');

      // ZeroTier
      expect(classifyInterface('ZeroTier One [abcd]', '10.147.17.42')).toBe('zerotier');

      // Standard LAN RFC1918
      expect(classifyInterface('Wi-Fi', '192.168.1.105')).toBe('lan');
      expect(classifyInterface('Ethernet', '10.0.0.15')).toBe('lan');
      expect(classifyInterface('Office LAN', '172.20.10.4')).toBe('lan');
    });

    it('ignores loopback (127.x.x.x) and link-local (169.254.x.x)', () => {
      expect(classifyInterface('Loopback', '127.0.0.1')).toBeNull();
      expect(classifyInterface('APIPA', '169.254.120.4')).toBeNull();
    });
  });

  describe('Geometric Magnetic Connection Snapping (28px Halo)', () => {
    const nodeA: BoxNode = { id: 'node-a', x: 100, y: 100, width: 200, height: 120 };
    const nodeB: BoxNode = { id: 'node-b', x: 400, y: 100, width: 200, height: 120 };
    const nodes = [nodeA, nodeB];

    it('computes accurate port coordinates for all 4 bounding box edges', () => {
      // nodeB: x:400..600, y:100..220
      expect(getPortCoordinates(nodeB, 'top')).toEqual({ x: 500, y: 100 });
      expect(getPortCoordinates(nodeB, 'right')).toEqual({ x: 600, y: 160 });
      expect(getPortCoordinates(nodeB, 'bottom')).toEqual({ x: 500, y: 220 });
      expect(getPortCoordinates(nodeB, 'left')).toEqual({ x: 400, y: 160 });
    });

    it('magnetically snaps to the nearest port when dropped within the 28px halo', () => {
      // Dropping 12px to the left of nodeB left port (388, 160)
      const snapLeft = findMagneticTargetPort(nodes, 'node-a', 388, 160, 28);
      expect(snapLeft).not.toBeNull();
      expect(snapLeft?.nodeId).toBe('node-b');
      expect(snapLeft?.side).toBe('left');
      expect(snapLeft?.point).toEqual({ x: 400, y: 160 });

      // Dropping 15px above nodeB top port (500, 85)
      const snapTop = findMagneticTargetPort(nodes, 'node-a', 500, 85, 28);
      expect(snapTop).not.toBeNull();
      expect(snapTop?.nodeId).toBe('node-b');
      expect(snapTop?.side).toBe('top');
      expect(snapTop?.point).toEqual({ x: 500, y: 100 });

      // Dropping 20px to the right of nodeB right port (620, 160)
      const snapRight = findMagneticTargetPort(nodes, 'node-a', 620, 160, 28);
      expect(snapRight).not.toBeNull();
      expect(snapRight?.nodeId).toBe('node-b');
      expect(snapRight?.side).toBe('right');
      expect(snapRight?.point).toEqual({ x: 600, y: 160 });
    });

    it('never snaps to the source node itself', () => {
      const snapSelf = findMagneticTargetPort(nodes, 'node-a', 290, 160, 28);
      expect(snapSelf).toBeNull();
    });

    it('returns null when cursor is beyond the magnetic halo threshold', () => {
      const snapFar = findMagneticTargetPort(nodes, 'node-a', 350, 160, 28);
      expect(snapFar).toBeNull();
    });
  });

  describe('Cubic Bezier Edge Path Generation', () => {
    it('generates a valid SVG cubic Bezier path with smooth control handles', () => {
      const pathD = buildBezierEdgePath(300, 160, 'right', 400, 160, 'left');
      expect(pathD).toMatch(/^M 300 160 C \d+(\.\d+)? 160, \d+(\.\d+)? 160, 400 160$/);
    });

    it('handles orthogonal port configurations (e.g. bottom to top)', () => {
      const pathD = buildBezierEdgePath(200, 220, 'bottom', 500, 100, 'top');
      expect(pathD.startsWith('M 200 220 C')).toBe(true);
      expect(pathD.endsWith('500 100')).toBe(true);
    });
  });
});

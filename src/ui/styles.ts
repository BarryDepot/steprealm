// Shared styles. Keeping these in one place so the look stays consistent
// across screens while the design is still in flux.

import { StyleSheet } from 'react-native';

export const palette = {
  bg:        '#1a1410',
  panel:     '#241b15',
  panelEdge: '#3d2e22',
  text:      '#ebd8b2',
  textDim:   '#8c7a5e',
  accent:    '#d6a85c',
  good:      '#7bb86f',
  bad:       '#c46060',
};

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
    padding: 16,
  },
  title: {
    color: palette.accent,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  sectionLabel: {
    color: palette.textDim,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 6,
  },
  panel: {
    backgroundColor: palette.panel,
    borderColor: palette.panelEdge,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: {
    color: palette.text,
    fontSize: 15,
  },
  textDim: {
    color: palette.textDim,
    fontSize: 13,
  },
  button: {
    backgroundColor: palette.accent,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: '#1a1410',
    fontWeight: '700',
  },
  ghostButton: {
    borderColor: palette.panelEdge,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  ghostButtonText: {
    color: palette.text,
    fontWeight: '600',
  },
});

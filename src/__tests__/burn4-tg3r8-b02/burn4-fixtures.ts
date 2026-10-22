import { type Burn4SpeechInputPanelProps } from '../../components/input/Burn4SpeechInputPanel';

export const languages = Object.freeze([
  Object.freeze({ tag: 'en-US', label: 'English' }),
  Object.freeze({ tag: 'es-MX', label: 'Español' }),
]);

export function makeTarget(tag = 'input'): HTMLElement {
  const target = document.createElement(tag);
  target.getBoundingClientRect = () => ({ left: 100, top: 300, width: 200, height: 40, right: 300, bottom: 340, x: 100, y: 300, toJSON: () => ({}) });
  document.body.appendChild(target);
  return target;
}

export function panelProps(target: Element): Burn4SpeechInputPanelProps {
  return {
    visible: true, activeTarget: target, activeSessionId: 'one', language: 'en-US', languages,
    feedback: { sessionId: 'one', target, isListening: true, interimText: 'Hello there' },
    onLanguageChange: jest.fn(), onStop: jest.fn(),
  };
}

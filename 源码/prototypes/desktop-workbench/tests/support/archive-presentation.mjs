const presentations = new Set(['ArchiveWall', 'ArchiveObject', 'ArchiveFace', 'ArchiveIndex', 'ArchiveZoom', 'ArchiveSpec']);

// Handler fixtures inspect the rendered controls but keep presentation-local
// state inert. Expand the real archive views without consuming the root hook
// fixture's state slots; hover and zoom require separate browser acceptance.
export function withArchivePresentation(react, createElement) {
  return (type, props, ...children) => {
    const element = createElement(type, props, ...children);
    if (typeof type !== 'function' || !presentations.has(type.name)) return element;
    const { useState, useRef } = react;
    react.useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}];
    react.useRef = (initial) => ({ current: initial });
    try {
      const rendered = type(element.props);
      return props?.key === undefined || !rendered ? rendered : { ...rendered, props: { ...rendered.props, key: props.key } };
    } finally {
      react.useState = useState;
      react.useRef = useRef;
    }
  };
}

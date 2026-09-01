(() => {
  const readPreference = () => {
    try {
      return localStorage.getItem('together-color-scheme');
    } catch {
      return null;
    }
  };

  const preference = readPreference();
  const media = matchMedia('(prefers-color-scheme: dark)');
  const dark = preference === 'dark' || (preference !== 'light' && media.matches);
  document.documentElement.style.backgroundColor = dark ? '#101113' : '#FAFAF9';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  if ((preference === 'light' || preference === 'dark') && dark !== media.matches) {
    const activeMedia = media.matches
      ? '(prefers-color-scheme: dark)'
      : '(prefers-color-scheme: light)';
    const meta = document.querySelector(`meta[name="theme-color"][media="${activeMedia}"]`);
    if (meta) meta.content = dark ? '#101113' : '#FAFAF9';
  }
})();

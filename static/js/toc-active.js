document.addEventListener("DOMContentLoaded", () => {
  const tocLinks = [...document.querySelectorAll(".book-toc nav a[href^='#']")];

  if (!tocLinks.length) return;

  const headings = tocLinks
    .map(link => {
      const id = decodeURIComponent(link.hash.slice(1));
      const heading = document.getElementById(id);
      return heading ? { link, heading } : null;
    })
    .filter(Boolean);

  if (!headings.length) return;

  function updateActiveHeading() {
    const offset = 120;
    let active = headings[0];

    for (const item of headings) {
      if (item.heading.getBoundingClientRect().top <= offset) {
        active = item;
      } else {
        break;
      }
    }

    for (const item of headings) {
      const isActive = item === active;
      item.link.classList.toggle("active", isActive);

      if (isActive) {
        item.link.setAttribute("aria-current", "location");
      } else {
        item.link.removeAttribute("aria-current");
      }
    }
  }

  window.addEventListener("scroll", updateActiveHeading, { passive: true });
  window.addEventListener("resize", updateActiveHeading);
  updateActiveHeading();
});
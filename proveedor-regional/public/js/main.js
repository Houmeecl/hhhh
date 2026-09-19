(() => {
  'use strict';

  document.getElementById('year').textContent = new Date().getFullYear();

  // ---------- Mobile nav ----------
  const header = document.querySelector('.site-header');
  const navToggle = document.getElementById('navToggle');
  navToggle.addEventListener('click', () => {
    const open = header.classList.toggle('nav-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.mobile-nav a').forEach((a) => {
    a.addEventListener('click', () => {
      header.classList.remove('nav-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  // ---------- Scroll-spy on nav links ----------
  const navLinks = Array.from(document.querySelectorAll('.main-nav .nav-link'));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = `#${entry.target.id}`;
        navLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === id));
      });
    },
    { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
  );
  sections.forEach((s) => spy.observe(s));

  // ---------- Back to top ----------
  const backToTop = document.getElementById('backToTop');
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 480);
  });
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ---------- Animated stat counters ----------
  const statNums = document.querySelectorAll('.stat-num');
  const animateCount = (el) => {
    const target = parseInt(el.dataset.count, 10);
    const prefix = el.dataset.prefix || '';
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString('es-CL');
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const statsObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.6 }
  );
  statNums.forEach((el) => statsObserver.observe(el));

  // ---------- Service tabs ----------
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.hidden = true;
        p.classList.remove('active');
      });
      const panel = document.getElementById(`panel-${tab.dataset.tab}`);
      if (panel) {
        panel.hidden = false;
        panel.classList.add('active');
      }
    });
  });

  // ---------- Comuna picker ----------
  const comunaCards = document.querySelectorAll('.comuna-card');
  const comunaName = document.getElementById('comunaDetailName');
  const comunaDesc = document.getElementById('comunaDetailDesc');
  comunaCards.forEach((card) => {
    card.addEventListener('click', () => {
      comunaCards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      comunaName.textContent = card.dataset.comuna;
      comunaDesc.textContent = card.dataset.desc;
    });
  });

  // ---------- Join form ----------
  const form = document.getElementById('joinForm');
  const formMsg = document.getElementById('formMsg');

  const setMsg = (text, kind) => {
    formMsg.textContent = text;
    formMsg.className = `form-msg ${kind || ''}`.trim();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const empresa = document.getElementById('fEmpresa').value.trim();
    const contacto = document.getElementById('fContacto').value.trim();
    const email = document.getElementById('fEmail').value.trim();
    const comuna = document.getElementById('fComuna').value;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!empresa || !contacto || !comuna) {
      setMsg('Completa todos los campos para continuar.', 'error');
      return;
    }
    if (!emailRe.test(email)) {
      setMsg('Ingresa un correo electrónico válido.', 'error');
      return;
    }

    try {
      const registros = JSON.parse(localStorage.getItem('proveedorRegional.registros') || '[]');
      registros.push({ empresa, contacto, email, comuna, fecha: new Date().toISOString() });
      localStorage.setItem('proveedorRegional.registros', JSON.stringify(registros));
    } catch (err) {
      // localStorage puede fallar en modo privado; no bloquea la confirmación visual.
    }

    setMsg(`¡Gracias, ${contacto}! Registramos a ${empresa} de ${comuna}. Te contactaremos pronto.`, 'ok');
    form.reset();
  });
})();

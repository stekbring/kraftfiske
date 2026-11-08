    const scriptURL = "https://script.google.com/macros/s/AKfycbyOiqgPr37tvuuixXDvAYTnPiw1GojWCTqFL_851PccIhCCcPQZIanEpF80uQzqWvl7UA/exec"; 
    let prices = { kokta: 0, levande: 0 };
    let soldOut = false; // true när det är slut på kräftor
    let lastAvailable = null;
    let lastPriceKokta = null;
    let lastPriceLevande = null;
    let firstLoad = true;

    // Skyddar mot hängande nätverksanrop genom att avbryta efter en viss tid
    async function fetchWithTimeout(url, options = {}, ms = 8000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    // Skyddar mot race conditions: om ett nytt loadMeta()-anrop startar
    // innan ett äldre hunnit svara, ignoreras det äldre svaret.
    let loadMetaRequestId = 0;

    async function loadMeta() {
      const myRequestId = ++loadMetaRequestId;
      const availableEl = document.getElementById("available");
      try {
        const res = await fetchWithTimeout(scriptURL);
        const data = await res.json();

        // Om ett nyare anrop redan har startat, kasta det här (gamla) svaret
        if (myRequestId !== loadMetaRequestId) return;

        const priceKoktaEl = document.getElementById("priceKokta");
        const priceLevandeEl = document.getElementById("priceLevande");

        if (firstLoad) {
          availableEl.textContent = "....";
          priceKoktaEl.textContent = "....";
          priceLevandeEl.textContent = "....";
        }

        // --- uppdatera bara om värdet ändrats ---
        if (data.available !== lastAvailable) {
          availableEl.textContent = data.available;
          lastAvailable = data.available;
        }

        if (data.pricePerKg.kokta !== lastPriceKokta) {
          priceKoktaEl.textContent = data.pricePerKg.kokta;
          lastPriceKokta = data.pricePerKg.kokta;
        }

        if (data.pricePerKg.levande !== lastPriceLevande) {
          priceLevandeEl.textContent = data.pricePerKg.levande;
          lastPriceLevande = data.pricePerKg.levande;
        }

        // uppdatera lokala priser och markera att första laddningen är klar
        prices = data.pricePerKg;
        firstLoad = false;

        // uppdatera priser och tillgänglighet
        prices = data.pricePerKg;
        document.getElementById("amount").max = data.available || 0;

        // --- NY FUNKTIONALITET: om slut på kräftor, göm order-relaterade fält ---
        const orderKg = document.querySelector('.kg-control');
        const typeSelect = document.getElementById('type');
        const totalP = document.querySelector('p.info');
        const priceP = document.getElementById('priceInfo');
        const bookingSubmit = document.querySelector('#bookingForm button[type="submit"]');
        const notifyBtn = document.getElementById('notifyBtn');
        const typeLabel = document.querySelector("#type").previousElementSibling;
        const newsletterLabel = document.querySelector(".newsletter-label");
        const emailField = document.getElementById("email");

        if (data.available <= 0) {
          soldOut = true;
          // göm kilo-kontroller, typ-val och totalsumma
          if (orderKg) orderKg.style.display = 'none';
          if (typeSelect) typeSelect.style.display = 'none';
          if (totalP) totalP.style.display = 'none';
          if (priceP) priceP.style.display = 'none';
          // göm ordinarie "Boka"-knapp (den ligger först i DOM-listan över submit-knappar)
          if (bookingSubmit) bookingSubmit.style.display = 'none';
          // visa den enklare submit-knappen för att anmäla sig
          if (notifyBtn) notifyBtn.style.display = 'block';
          if (typeLabel) typeLabel.style.display = 'none';
          if (newsletterLabel) newsletterLabel.style.display = 'none';
          if (emailField) emailField.placeholder = '';

          // uppdatera status-texten högst upp (men behåll en dold span#available för framtida uppdateringar)
          const statusP = availableEl.parentElement;
          statusP.innerHTML = '<b>Tyvärr finns inga kräftor tillgängliga just nu. <br><br></b> Fyll i dina uppgifter för att få ett meddelande när nya kräftor finns tillgängliga. <span id="available" style="display:none">0</span>';
          // markera automatisk att användaren vill ha mail
          const news = document.getElementById('newsletter'); if (news) news.checked = true;
        } else {
          // återställ vy till normal
          soldOut = false;
          if (orderKg) orderKg.style.display = '';
          if (typeSelect) typeSelect.style.display = '';
          if (totalP) totalP.style.display = '';
          if (priceP) priceP.style.display = '';
          if (bookingSubmit) bookingSubmit.style.display = '';
          if (typeLabel) typeLabel.style.display = '';
          if (newsletterLabel) newsletterLabel.style.display = '';
          if (notifyBtn) notifyBtn.style.display = 'none';
          if (emailField) emailField.placeholder = 'Valfritt';

          // återställ status-text
          const statusP = availableEl.parentElement;
          statusP.innerHTML = `<b>Tillgängliga kräftor:</b> <span id="available">${data.available}</span> kg <span class="info-label">(1 kg är ca 20 kräftor)</span>`;
        }

      } catch (err) {
        // Ignorera fel från gamla, redan överspelade anrop
        if (myRequestId !== loadMetaRequestId) return;
        availableEl.textContent = err.name === "AbortError"
          ? "Kunde inte hämta data (timeout). Försöker igen snart..."
          : "Fel vid hämtning!";
        console.error(err);
      }
    }

    function changeKg(step) {
      let current = parseFloat(document.getElementById("amount").value) || 0;
      current = Math.max(0, current + step);
      current = Math.round(current * 2) / 2;
      document.getElementById("amount").value = current;
      document.getElementById("kgDisplay").textContent = current.toFixed(1);
      updateTotal();
    }

    function updateTotal() {
      const antal = parseFloat(document.getElementById("amount").value) || 0;
      const typ = document.getElementById("type").value;
      const total = antal * (prices[typ] || 0);
      document.getElementById("total").textContent = total;
    }

    document.getElementById("amount").addEventListener("input", updateTotal);
    document.getElementById("type").addEventListener("change", updateTotal);

    document.getElementById("bookingForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      // Förhindra dubbelbokning om användaren klickar flera gånger snabbt
      const submitButtons = e.currentTarget.querySelectorAll('button[type="submit"]');
      submitButtons.forEach(btn => btn.disabled = true);

      try {

      // Om slut på kräftor: skicka bara anmälan om nyhetsbrev (namn + epost eller telefonnummer)
      if (soldOut) {
        const name = document.getElementById("name").value.trim();
        const phone = document.getElementById("phone").value.trim();
        const email = document.getElementById("email").value.trim();
        const resultEl = document.getElementById("result");
        if (!name) { resultEl.textContent = 'Fyll i ditt namn.'; return; }
        if (!phone && !email) { resultEl.textContent = 'Fyll i e-post eller telefonnummer så vi kan kontakta dig.'; return; }

        const notifyPayload = { action: "notify", name: name, phone: phone, email: email, newsletter: true };
        resultEl.textContent = 'Skickar anmälan...';
        try {
          const res = await fetchWithTimeout(scriptURL, { method: "POST", body: JSON.stringify(notifyPayload) });
          const parsed = await res.json();
          if (parsed && parsed.success) {
            if (parsed.newsletterStatus === "added") {
              resultEl.textContent = 'Tack! Du har lagts till på nyhetsbrevet och får ett mail när nya kräftor finns.';
            } else if (parsed.newsletterStatus === "exists") {
              resultEl.textContent = 'Din e-post finns redan i nyhetsbrevslistan. Vi meddelar dig när nya kräftor finns.';
            } else {
              resultEl.textContent = "Tack! Vi kontaktar dig när nya kräftor finns tillgängliga.";
            }
          } else {
            resultEl.textContent = 'Tack! Vi kontaktar dig när nya kräftor finns tillgängliga.';
          }
        } catch (err) {
          resultEl.textContent = "Fel vid anmälan! Försök igen senare.";
          console.error(err);
        }

        return; // gör inte vanlig bokning
      }

      // --- vanlig bokningslogik (oförändrad) ---
      const booking = {
        action: "book",
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        newsletter: document.getElementById("newsletter").checked,
        amount: parseFloat(document.getElementById("amount").value),
        type: document.getElementById("type").value
      };

      const resultEl = document.getElementById("result");
      resultEl.textContent = "Skickar bokning...";
      try {
        const res = await fetchWithTimeout(scriptURL, {
          method: "POST",
          body: JSON.stringify(booking)
        });
        const result = await res.json();
        if (result.success) {
          const prisText = result.pris 
            ? `${result.pris} kr`
            : `${booking.amount * (prices[booking.type] || 0)} kr`;

          let extraText = "";
          if (result.newsletterStatus === "added") {
            extraText = "<br><br>Du har lagts till på nyhetslistan och får <br> ett mail när nya kräftor finns.";
          } else if (result.newsletterStatus === "exists") {
            extraText = "<br><br>Din e-postadress finns redan i nyhetslistan.";
          }

          document.getElementById("popupText").innerHTML =
            `Du har bokat ${booking.amount} kg ${booking.type} kräftor för totalt ${prisText}.<br><br>Bokningsbekräftelse skickas via e-post.${extraText}`;

          document.getElementById("popup").style.display = "flex";
          resultEl.textContent = "";
          await loadMeta();
          updateTotal();
        }

          else if (result.error === "NOT_ENOUGH_STOCK") {
          resultEl.textContent = `Det finns bara ${result.available} kg kräftor kvar.`;
          await loadMeta();
        } else {
          resultEl.textContent = "Något gick fel. Försök igen.";
        }
      } catch (err) {
        resultEl.textContent = "Fel vid bokning!";
        console.error(err);
      }

      } finally {
        submitButtons.forEach(btn => btn.disabled = false);
      }
    });

    function closePopup() {
      document.getElementById("popup").style.display = "none";
    }

    function showTab(e, id) {
      document.querySelectorAll(".tab-content").forEach(sec => sec.classList.remove("active"));
      document.querySelectorAll("nav a").forEach(link => link.classList.remove("active"));
      document.getElementById(id).classList.add("active");
      e.target.classList.add("active");
    }

    document.getElementById("year").textContent = new Date().getFullYear();
    loadMeta();

    // justera kravet på epost endast när det inte är "slut"
    document.getElementById("newsletter").addEventListener("change", function() {
      const emailField = document.getElementById("email");
      if (this.checked && !soldOut) {
        emailField.required = true;
        emailField.placeholder = "Obligatorisk om du vill ha nyhetsbrev";
      } else {
        emailField.required = false;
        emailField.placeholder = "Valfritt";
      }
    });

    let intervalId;

    function startAutoUpdate() {
      if (!intervalId) {
        intervalId = setInterval(loadMeta, 12000); // uppdatera var 12:e sekund när sidan är aktiv (skonar Apps Script-kvoten)
      }
    }

    function stopAutoUpdate() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    // Starta uppdatering direkt om sidan är aktiv
    if (!document.hidden) startAutoUpdate();

    // Lyssna på när användaren byter flik
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAutoUpdate(); // pausa när sidan är i bakgrunden
      } else {
        loadMeta();       // uppdatera direkt när användaren kommer tillbaka
        startAutoUpdate(); // starta intervallet igen
      }
    });


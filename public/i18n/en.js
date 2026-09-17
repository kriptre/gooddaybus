window.__I18N__={"app":{"status":{"loadingCities":"Loading cities...","citiesReady":"{n} cities available - choose your route","citiesFailed":"Could not load cities - check your connection","retry":"Try again"},"date":{"dow":["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],"monShort":["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],"monFull":["January","February","March","April","May","June","July","August","September","October","November","December"],"earlier":"Earlier","later":"Later","placeholder":"Choose a date"},"ac":{"recent":"Recent","popular":"Popular routes"},"search":{"differentCities":"Enter different cities","checkCities":"Check the city names or pick one from the suggestions","searching":"Searching for trips...","searchingBtn":"Searching...","findRoute":"Find a bus","error":"Error: {msg}"},"suggest":{"otherDate":"No trips on the selected date, but there are on {d}:","showOtherDate":"Show trips on {d}","noDirect":"No direct trips. Tap a nearby city to see trips:","none":"Try a different date or route, or contact the manager below.","routeForms":["trip","trips"],"km":"km"},"transfers":{"direct":"No transfers, direct trip","forms":["transfer","transfers"]},"duration":{"hour":"h","dayForms":["day","days"]},"amenities":{"wifi":{"i":"wifi","t":"Wi-Fi"},"power":{"i":"plug","t":"Power outlets"},"air":{"i":"snowflake","t":"Air conditioning"},"wc":{"i":"restroom","t":"Restroom"},"pets":{"i":"paw","t":"Pets allowed"},"gps":{"i":"location-crosshairs","t":"GPS tracking"},"seatselect":{"i":"chair","t":"Seat selection"},"addstop":{"i":"map-pin","t":"Extra stops"},"noprepayment":{"i":"hand-holding-dollar","t":"No prepayment"},"norefund":{"i":"ban","t":"Non-refundable ticket"},"pet-only-from-eu":{"i":"paw","t":"Pets - EU-bound trips only"},"starlink":{"i":"wifi","t":"Satellite internet (Starlink)"},"drinks":{"i":"cup","t":"Drinks"},"steward":{"i":"user","t":"Onboard steward"},"noAccompany":"Children {n}+ unaccompanied"},"pay":{"none":"No prepayment","groupNote":"Prepayment required for groups","partial":"Partial prepayment","full":"Full prepayment"},"results":{"amenitiesLabel":"Amenities","noneFoundTitle":"No trips found","noneFoundBody":"No trips on {date} for {dep} → {arr}.","noneFoundStatus":"No trips found","searchingSuggest":"Looking for the nearest dates and cities...","found":"{n} trips found","badge":"{n} trips","sort":"Sort:","sortPrice":"Cheapest","sortDuration":"Fastest","sortDeparture":"By departure time","filters":"Filters:","filterDirect":"No transfers","filterPets":"With a pet","filteredNoneTitle":"No trips like that","filteredNoneBody":"No trips on this route match the selected filters.<br>Turn off the filter to see all options."},"card":{"busFallback":"Bus","enRoute":"en route","direct":"no transfers","withTransfer":"with a transfer","perSeat":"per seat","free":"available","details":"Trip details","book":"Book now","order":"Order","payment":"Payment","discLabel":"Discounts","transfers":"Transfers","carrier":"Carrier","reliability":"{n}% reliability","ratingTitle":"Rating {raw} of {max}","baggage":"Baggage","collapse":"Collapse","moreBtn":"Show {n} more · {total} {word} total"},"discounts":{"unavailable":"Information unavailable","loading":"Loading...","none":"No special discounts"},"pax":{"delete":"Delete","firstName":"First name","firstNamePh":"John","lastName":"Last name","lastNamePh":"Smith","phone":"Phone","phonePh":"+1 234 567 8900","title":"Passenger #{n}","fullTicket":"Full-price ticket","discTitle":"Passenger discount","total":"Total for {n} {word}:"},"seats":{"forms":["seat","seats"],"driver":"Driver","table":"Table","taken":"Taken","auto":"Automatic","launch":"Choose seat","optional":"optional","deck":"Floor {n}","legendFree":"available","legendSel":"yours","legendTaken":"taken","chosen":"Selected: <b>{names}</b> ({n} of {need})","hint":"Tap available seats on the layout{needClause} - or leave as is and seats will be assigned automatically.","hintNeedClause":" (need {n})"},"modal":{"titleBook":"Book the trip","titleOrder":"Order the trip","groupPrepayBadge":"Prepayment for 1 ticket","groupNote":"From {thr} passengers, the carrier requires prepayment for 1 ticket. Up to {thrMinus1} - no prepayment, pay the driver."},"order":{"send":"Send","booking":"Booking...","sending":"Sending...","phoneIncomplete":"Check the phone number - it looks incomplete.","fillAllFields":"Fill in the details for all passengers.","yourSeats":"Your seats","bookedTitle":"Seats booked!","bookedTextWithTickets":"Payment - to the driver at boarding.<br>Save your tickets:","bookedTextNoTickets":"Payment - to the driver at boarding.<br>The manager will send the tickets shortly.","downloadTicket":"Download ticket","acceptedTitle":"Request accepted!","acceptedText":"The manager will contact you, confirm the details<br>and send payment details if needed.","submitError":"Could not send the request: {msg}\n\nTry again or call the manager.","copyLabel":"Copy","copiedLabel":"Copied!"},"track":{"on":"Tracking enabled: this browser is counted in site statistics again.","off":"Done: visits and searches from this browser will no longer be counted in site statistics."}},"common":{"cookieAria":"Consent to use cookies","cookieText":"We use cookies to make the site work well and to keep improving it for you. Click \"Accept\" - this helps us improve the service. More details - in the <a href=\"/cookies\">Cookie Policy</a>.","cookieAccept":"Accept","cookieMinimal":"Necessary only","scrollTop":"To top"}};
(function (d) {
    var specs = [
    { path: 'status.citiesReady', params: ['n'] },
    { path: 'search.error', params: ['msg'] },
    { path: 'suggest.otherDate', params: ['d'] },
    { path: 'suggest.showOtherDate', params: ['d'] },
    { path: 'amenities.noAccompany', params: ['n'] },
    { path: 'results.noneFoundBody', params: ['date', 'dep', 'arr'] },
    { path: 'results.found', params: ['n'] },
    { path: 'results.badge', params: ['n'] },
    { path: 'card.reliability', params: ['n'] },
    { path: 'card.ratingTitle', params: ['raw', 'max'] },
    { path: 'card.moreBtn', params: ['n', 'total', 'word'] },
    { path: 'pax.title', params: ['n'] },
    { path: 'pax.total', params: ['n', 'word'] },
    { path: 'seats.deck', params: ['n'] },
    { path: 'seats.chosen', params: ['names', 'n', 'need'] },
    { path: 'modal.groupNote', params: ['thr'], derived: { thrMinus1: function (a) { return a.thr - 1; } } },
    { path: 'order.submitError', params: ['msg'] }
];
    specs.forEach(function (spec) {
        var ks = spec.path.split('.'), o = d;
        for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
        var k = ks[ks.length - 1];
        var tpl = o[k];
        o[k] = function () {
            var args = arguments, ctx = {};
            spec.params.forEach(function (p, i) { ctx[p] = args[i]; });
            if (spec.derived) Object.keys(spec.derived).forEach(function (dk) { ctx[dk] = spec.derived[dk](ctx); });
            var s = tpl;
            Object.keys(ctx).forEach(function (ck) { s = s.split('{' + ck + '}').join(ctx[ck]); });
            return s;
        };
    });
    var hintBase = d.seats.hint, hintNeed = d.seats.hintNeedClause;
    d.seats.hint = function (need) {
        var clause = need > 1 ? hintNeed.split('{n}').join(need) : '';
        return hintBase.split('{needClause}').join(clause);
    };
})(window.__I18N__.app);

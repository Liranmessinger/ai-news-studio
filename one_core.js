
class LocalStorageManager {
    constructor(keyPrefix = null, onExpired = null, onSuccess = null) {
        this.onExpired = onExpired || function (key) {
            this.log(`Данные для ключа "${key}" устарели и удалены.`);
        };

        this.onSuccess = onSuccess || function (key, value) {
            this.log(`Данные для ключа "${key}" получены:`, value);
        };

        this.keyPrefix = keyPrefix || "one_";
    }

    
    Set(key, value, ttl) {
        const expires = Date.now() + ttl * 1000;
        const data = { value, expires };
        localStorage.setItem(this.keyPrefix + key, JSON.stringify(data));
    }

    
    Get(key) {
        const item = localStorage.getItem(this.keyPrefix + key);

        if (!item) return null; // Not found

        const data = JSON.parse(item);

        if (Date.now() > data.expires) {
            localStorage.removeItem(this.keyPrefix + key);
            this.onExpired(this.keyPrefix + key);
            return null;
        }

        this.onSuccess(this.keyPrefix + key, data.value);

        if (!data.value)
            return null;

        return data.value;
    }

    
    Remove(key) {
        localStorage.removeItem(this.keyPrefix + key);
    }

    
    Clear() {
        localStorage.clear();
    }

    log(message) {
        //logone("localStorage: " + message);
    }
}
/*
NOT TESTED

// Create
const dbManager = new IndexedDBManager(
    "MyDatabase",
    "MyStore",
    1,
    (key) => console.log(`❌ Данные "${key}" истекли и удалены.`),
    (key, value) => console.log(`✅ Данные "${key}" загружены:`, value)
);

// Set
await dbManager.set("user", { name: "John", age: 30 }, 300000);

// Get
const user = await dbManager.get("user");
console.log(user); // { name: "John", age: 30 } или null, если TTL истек


// Remove
await dbManager.remove("user");


// clear all db
await dbManager.clear();


// remove expired
await dbManager.cleanup();


// Search
const users = await dbManager.search("value.name", "John");
console.log(users);


// Sort
const sortedUsers = await dbManager.getAllSorted("age", "asc");
console.log(sortedUsers);


*/


class IndexedDBManager {
    constructor(dbName = "MyDatabase", storeName = "MyStore", version = 1, onExpired = null, onSuccess = null) {
        this.dbName = dbName;
        this.storeName = storeName;
        this.version = version;

        this.onExpired = onExpired || function (key) {
            console.warn(`❌ Данные для ключа "${key}" устарели и удалены.`);
        };
        this.onSuccess = onSuccess || function (key, value) {
            console.log(`✅ Данные "${key}" получены:`, value);
        };

        this.db = null;
    }

    async openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: "key" });
                    store.createIndex("expires", "expires", { unique: false });
                    store.createIndex("valueIndex", "value", { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => reject(`Ошибка IndexedDB: ${event.target.error}`);
        });
    }

    async set(key, value, ttl) {
        const db = await this.openDB();
        const expires = Date.now() + ttl;

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            store.put({ key, value, expires });

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(`Ошибка сохранения: ${event.target.error}`);
        });
    }

    async get(key) {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve(null);
                    return;
                }

                if (Date.now() > result.expires) {
                    this.remove(key);
                    this.onExpired(key);
                    resolve(null);
                } else {
                    this.onSuccess(key, result.value);
                    resolve(result.value);
                }
            };

            request.onerror = (event) => reject(`Ошибка получения: ${event.target.error}`);
        });
    }

    async remove(key) {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            store.delete(key);

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(`Ошибка удаления: ${event.target.error}`);
        });
    }

    async clear() {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            store.clear();

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(`Ошибка очистки: ${event.target.error}`);
        });
    }

    async cleanup() {
        const db = await this.openDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const index = store.index("expires");
            const request = index.openCursor();

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    if (Date.now() > cursor.value.expires) {
                        store.delete(cursor.primaryKey);
                        this.onExpired(cursor.primaryKey);
                    }
                    cursor.continue();
                }
            };

            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => reject(`Ошибка очистки устаревших данных: ${event.target.error}`);
        });
    }

    
    async search(field, searchValue) {
        const db = await this.openDB();
        const results = [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const value = cursor.value;
                    const keys = field.split(".");
                    let fieldValue = value;

                    keys.forEach((key) => {
                        if (fieldValue && fieldValue[key] !== undefined) {
                            fieldValue = fieldValue[key];
                        } else {
                            fieldValue = undefined;
                        }
                    });

                    if (fieldValue === searchValue) {
                        results.push(value);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            request.onerror = (event) => reject(`Ошибка поиска: ${event.target.error}`);
        });
    }

    
    async getAllSorted(sortBy, order = "asc") {
        const db = await this.openDB();
        const results = [];

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    results.sort((a, b) => {
                        const aValue = a.value[sortBy] || 0;
                        const bValue = b.value[sortBy] || 0;

                        if (order === "asc") {
                            return aValue > bValue ? 1 : -1;
                        } else {
                            return aValue < bValue ? 1 : -1;
                        }
                    });

                    resolve(results);
                }
            };

            request.onerror = (event) => reject(`Ошибка сортировки: ${event.target.error}`);
        });
    }
}
Element.prototype.setAttributes = function (attributes) {
    Object.keys(attributes).forEach(attr => {
        this.setAttribute(attr, attributes[attr]);
    });
};


Element.prototype.setDataAttributes = function (data) {
    Object.keys(data).forEach(key => {
        this.dataset[key] = data[key];
    });
};

Element.prototype.getAttributes = function () {
    const attributes = {};
    for (let attr of this.attributes) {
        attributes[attr.name] = attr.value;
    }
    return attributes;
};

Element.prototype.getDataAttributes = function () {
    return { ...this.dataset };
};
var isChrome = navigator.userAgent.indexOf('Chrome') > -1;
var isExplorer = navigator.userAgent.indexOf('MSIE') > -1;
var isFirefox = navigator.userAgent.indexOf('Firefox') > -1;
var isSafari = navigator.userAgent.indexOf("Safari") > -1;
var isOpera = navigator.userAgent.toLowerCase().indexOf("op") > -1;
if (isChrome && isSafari) { isSafari = false; }
if (isChrome && isOpera) { isChrome = false; }

(function ($) {

    window.FetchData = async function (url) {
        try {

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Wrong response: ${response.status}`);
            }

            const data = await response.json();
            return data;  // return as json
        } catch (error) {
            console.error('Error occurs: ', error);
        }
    };

    window.IsIL2 = function () {

        const imageUrl = 'https://wow4geo.one.co.il/images/winner_button_app.png';

        fetch(imageUrl, { method: 'GET' }) // HEAD instead GET, for prevent upload all image
            .then(response => {
                if (response.status === 200) {
                    // success
                    console.log('Image exists and is accessible.');
                    // what to do
                    document.body.style.backgroundColor = 'lightgreen';
                } else {
                    // failed
                    console.warn('Image not accessible. Status:', response.status);
                    // what to do
                    document.body.style.backgroundColor = 'lightcoral';
                }
            })
            .catch(error => {
                // Error or cors
                console.error('Request failed:', error);
                // what to do
                document.body.style.backgroundColor = 'gray';
            });
    };

    window.IsIL = function () {

        logone("IsIL check");

        const imageUrl = 'https://wow4geo.one.co.il/images/winner_button_app.png';

        const img = new Image();
        img.onload = function () {
            logone('IsILtrue');

            IsIsrael = config.IsIsrael = true;
            SetCookieDays("IPIsIsrael", config.IsIsrael, 30);

            return true;
        };

        img.onerror = function () {
            logone('IsILfalse');

            IsIsrael = config.IsIsrael = false;
            SetCookieDays("IPIsIsrael", config.IsIsrael, 30);

            return false;
        };

        img.src = imageUrl;
    };

})(jQuery);


function OnElementReady(selector, callback) {
    const el = document.querySelector(selector);
    if (el) return callback(el);

    const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
            observer.disconnect();
            callback(el);
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
}










function log(text)
{
    console.log("ONE_dev: " + text);
}

function logone(text) {
    console.log("ONE_dev: " + text);
}

function GetQueryString(variable) {

    var query = window.location.search.substring(1);
    var vars = query.split("&");
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split("=");
        if (pair[0] === variable)
            return pair[1];
    }

    return "";
}

function IsNullOrEmpty(value) {
    return IsNullOrUndefined(value) || value === "";
}

function IsNullOrUndefined(value) {
    return value === undefined || value === null;
}

function IsUndefined(value) {
    return IsNullOrUndefined(value);
}

function IsNull(value) {
    return IsNullOrUndefined(value);
}

function FindEnumByID(jEnum, id) {
    const element = Object.values(jEnum).filter(item => item.ID === id);

    if (element.length > 0)
        return element[0];

    return null;
}

////////////////////////////////////
////////////////////////////////////
//
// see below
//
////////////////////////////////////
///////////////////////////////////


//
// IP && CuntryLookUp
// http://www.west-wind.com/WebLog/posts/107136.aspx
//
function GetClientIP() {
    var isNeedRegetIPData = false;

    if (GetCookie("IPClientIP"))
        IP = GetCookie("IPClientIP");
    else
        isNeedRegetIPData = true;

    if (GetCookie("IPIsIsrael"))
        IsIsrael = config.IsIsrael = GetCookie("IPIsIsrael").toString().toLowerCase() === "true" ? true : false;
    else
        IsIL();

    if (isNeedRegetIPData) {
        document.write('<script src="https://svc.one.co.il/SetIPData" async></script>');
    }
    
}

function SetIPData(Result) {
    IsIsrael = Result.IsIsrael.toLowerCase() === "true" ? true : false;
    IP = Result.IP;

    SetCookieDays("IPClientIP", IP, 30);
    SetCookieDays("IPIsIsrael", config.IsIsrael, 30);
}







// Open centered popup
// return reference to new opened window
function OpenWindow(url, name, wwidth, wheight, isResizable, isMenu, isToolbar, isStatusbar, isLocation, isScroll) {
    var xpos = GetWindowWidth() / 2 - wwidth / 2;
    var ypos = GetWindowHeight() / 2 - wheight / 2;
    var params = "";
    params += "menubar=" + (isMenu ? 1 : 0) + ",";
    params += "status=" + (isStatusbar ? 1 : 0) + ",";
    params += "toolbar=" + (isToolbar ? 1 : 0) + ",";
    params += "location=" + (isLocation ? 1 : 0) + ",";
    params += "resizable=" + (isResizable ? 1 : 0) + ",";
    params += "scrollbars=" + (isScroll ? 1 : 0) + ",";
    params += "left=" + xpos + ",";
    params += "top=" + ypos + ",";
    params += "width=" + wwidth + ",";
    params += "height=" + wheight;

    if (name.toLowerCase().indexOf("http://") > -1) {
        var t = name;
        name = url;
        url = t;
    }
    var wopen = window.open(url, name, params);

    return wopen;
}

function GetWindowWidth() {
    return document.documentElement.clientWidth ? document.documentElement.clientWidth : document.body.clientWidth;
}

function GetWindowHeight() {
    return document.documentElement.clientHeight ? document.documentElement.clientHeight : document.body.clientHeight;
}

function GetHebrewDayName(en) {
    switch (en.toLowerCase()) {
        case "sunday":
            return "ראשון";
        case "monday":
            return "שני";
        case "tuesday":
            return "שלישי";
        case "wednesday":
            return "רביעי";
        case "thursday":
            return "חמישי";
        case "friday":
            return "שישי";
        case "saturday":
            return "שבת";


        case "sun":
            return "א";
        case "mon":
            return "ב";
        case "tue":
            return "ג";
        case "wed":
            return "ד";
        case "thu":
            return "ה";
        case "fri":
            return "ו";
        case "sat":
            return "ש";

    }

    return en;
}


/*
 * Date Format 1.2.2
 * (c) 2007-2008 Steven Levithan <stevenlevithan.com>
 * MIT license
 * Includes enhancements by Scott Trenda <scott.trenda.net> and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 * http://blog.stevenlevithan.com/archives/date-time-format
 */

/*
d           Day of the month as digits; no leading zero for single-digit days. 
dd          Day of the month as digits; leading zero for single-digit days. 
ddd         Day of the week as a three-letter abbreviation. 
dddd        Day of the week as its full name. 
m           Month as digits; no leading zero for single-digit months. 
mm          Month as digits; leading zero for single-digit months. 
mmm         Month as a three-letter abbreviation. 
mmmm        Month as its full name. 
yy          Year as last two digits; leading zero for years less than 10. 
yyyy        Year represented by four digits. 
h           Hours; no leading zero for single-digit hours (12-hour clock). 
hh          Hours; leading zero for single-digit hours (12-hour clock). 
H           Hours; no leading zero for single-digit hours (24-hour clock). 
HH          Hours; leading zero for single-digit hours (24-hour clock). 
M           Minutes; no leading zero for single-digit minutes. Uppercase M unlike CF timeFormat's m to avoid conflict with months. 
MM          Minutes; leading zero for single-digit minutes. Uppercase MM unlike CF timeFormat's mm to avoid conflict with months. 
s           Seconds; no leading zero for single-digit seconds. 
ss          Seconds; leading zero for single-digit seconds. 
l or L      Milliseconds. l gives 3 digits. L gives 2 digits. 
t           Lowercase, single-character time marker string: a or p. No equivalent in CF. 
tt          Lowercase, two-character time marker string: am or pm. No equivalent in CF. 
T           Uppercase, single-character time marker string: A or P. Uppercase T unlike CF's t to allow for user-specified casing. 
TT          Uppercase, two-character time marker string: AM or PM. Uppercase TT unlike CF's tt to allow for user-specified casing. 
Z           US timezone abbreviation, e.g. EST or MDT. With non-US timezones or in the Opera browser, the GMT/UTC offset is returned, e.g. GMT-0500 No equivalent in CF. 
o           GMT/UTC timezone offset, e.g. -0500 or +0230. No equivalent in CF. 
S           The date's ordinal suffix (st, nd, rd, or th). Works well with d. No equivalent in CF. 
'…' or "…"  Literal character sequence. Surrounding quotes are removed. No equivalent in CF. 
UTC:        Must be the first four characters of the mask. Converts the date from local time to UTC/GMT/Zulu time before applying the mask. The "UTC:" prefix is removed.
            No equivalent in CF. 

And here are the named masks provided by default (you can easily change these or add your own):

Name Mask Example 
default                 ddd mmm dd yyyy HH:MM:ss        Sat Jun 09 2007 17:46:21 
shortDate               m/d/yy                          6/9/07 
mediumDate              mmm d, yyyy                     Jun 9, 2007 
longDate                mmmm d, yyyy                    June 9, 2007 
fullDate                dddd, mmmm d, yyyy              Saturday, June 9, 2007 
shortTime               h:MM TT                         5:46 PM 
mediumTime              h:MM:ss TT                      5:46:21 PM 
longTime                h:MM:ss TT Z                    5:46:21 PM EST 
isoDate                 yyyy-mm-dd                      2007-06-09 
isoTime                 HH:MM:ss                        17:46:21 
isoDateTime             yyyy-mm-dd'T'HH:MM:ss           2007-06-09T17:46:21 
isoUtcDateTime          UTC:yyyy-mm-dd'T'HH:MM:ss'Z'    2007-06-09T22:46:21Z 


HOW TO USE:

1.  Stand alone function : 
    var now = new Date();
    dateFormat(now, "dddd, mmmm dS, yyyy, h:MM:ss TT");

2.  Extensions method
    var now = new Date();
    now.Formst("h:MM:ss");

*/
var dateFormat = function () {
    var token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
		timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
		timezoneClip = /[^-+\dA-Z]/g,
		pad = function (val, len) {
            val = String(val);
            len = len || 2;
            while (val.length < len) val = "0" + val;
            return val;
		};

    // Regexes and supporting functions are cached through closure
    return function (date, mask, utc) {
        var dF = dateFormat;

        // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
        if (arguments.length === 1 && (typeof date === "string" || date instanceof String) && !/\d/.test(date)) {
            mask = date;
            date = undefined;
        }

        // Passing date through Date applies Date.parse, if necessary
        date = date ? new Date(date) : new Date();
        if (isNaN(date)) {
            SyntaxError("invalid date. Value was [ " + date + " ]");
            return "";
        }

        mask = String(dF.masks[mask] || mask || dF.masks["default"]);

        // Allow setting the utc argument via the mask
        if (mask.slice(0, 4) === "UTC:") {
            mask = mask.slice(4);
            utc = true;
        }

        var _ = utc ? "getUTC" : "get",
			d = date[_ + "Date"](),
			D = date[_ + "Day"](),
			m = date[_ + "Month"](),
			y = date[_ + "FullYear"](),
			H = date[_ + "Hours"](),
			M = date[_ + "Minutes"](),
			s = date[_ + "Seconds"](),
			L = date[_ + "Milliseconds"](),
			o = utc ? 0 : date.getTimezoneOffset(),
			flags = {
                d: d,
                dd: pad(d),
                ddd: dF.i18n.dayNames[D],
                dddd: dF.i18n.dayNames[D + 7],
                m: m + 1,
                mm: pad(m + 1),
                mmm: dF.i18n.monthNames[m],
                mmmm: dF.i18n.monthNames[m + 12],
                yy: String(y).slice(2),
                yyyy: y,
                h: H % 12 || 12,
                hh: pad(H % 12 || 12),
                H: H,
                HH: pad(H),
                M: M,
                MM: pad(M),
                s: s,
                ss: pad(s),
                l: pad(L, 3),
                L: pad(L > 99 ? Math.round(L / 10) : L),
                t: H < 12 ? "a" : "p",
                tt: H < 12 ? "am" : "pm",
                T: H < 12 ? "A" : "P",
                TT: H < 12 ? "AM" : "PM",
                Z: utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
                o: (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
                S: ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
			};

        return mask.replace(token, function ($0) {
            return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
        });
    };
}();

// Some common format strings
dateFormat.masks = {
    "default": "ddd mmm dd yyyy HH:MM:ss",
    shortDate: "m/d/yy",
    mediumDate: "mmm d, yyyy",
    longDate: "mmmm d, yyyy",
    fullDate: "dddd, mmmm d, yyyy",
    shortTime: "h:MM TT",
    mediumTime: "h:MM:ss TT",
    longTime: "h:MM:ss TT Z",
    isoDate: "yyyy-mm-dd",
    isoTime: "HH:MM:ss",
    isoDateTime: "yyyy-mm-dd'T'HH:MM:ss",
    isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
    dayNames: [
		"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
		"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
    ],
    monthNames: [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
		"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
    ]
};

// For convenience...
Date.prototype.Format = function (mask, utc) {
    return dateFormat(this, mask, utc);
};
/*

SECTIONS
  0. Universal document.ready for both platforms
  1. Marking session
  2. Voting | REMARKED AT 19/09/2022
  3. Video
  4. Count views

*/

const Platform = {
    Desktop: 0,
    Mobile: 1,
    Application: 2
};

const config = {
    Enums: null,
    API: {
        Version: 6,
        get URL() {
            return `https://api.one.co.il/json/v${this.Version}`;
        }
    }, // end API

    Ads: {
        IsEnabled: true,
        IsBlockerEnabled: false
    }, // end Ads

    Platform: Platform.Desktop,
    IsIsrael: true,

    end: false
};


const oneCache = new LocalStorageManager();



//var IsIsrael = true;

(function ($) {

    $(document).ready(function () {

        $("iframe[src*='youtube']").wrap("<div class='embed-container'></div>");
    });

    window.GetURLFromModel = function (modelURL) {

        var key = "";

        switch (config.Platform) {
            default:
                key = "PC";
                break;
            case Platform.Mobile:
                key = "Mobile";
                break;
            case Platform.Application:
                key = "App";
                break;
        }

        if (!IsNullOrUndefined(modelURL) && !IsNullOrUndefined(modelURL[key]))
            return modelURL[key];

        return "";

    };

    window.InitEnums = function () {

        var onenums = oneCache.Get("enums");

        if (onenums === null || onenums === undefined) {
            var url = config.API.URL + "/Enums/";

            FetchData(url)
                .then(data => {

                    if (IsNullOrUndefined(data) || IsNullOrUndefined(data.Data))
                        return;

                    config.Enums = data.Data;

                    oneCache.Set("enums", config.Enums, 60 * 60 * 12);

                    //logone("enums remote");
                });
        }
        else {
            //logone("enums local");
            config.Enums = onenums;
        }
    };
    

   
    

})(jQuery);


GetClientIP();
InitEnums();




function DoSearch(query) {
    document.location = "/Cat/General/SearchResults.aspx?oneSearchtype=1&isSearchInOne=true&q=" + escape(query);
}


function MarkSessionDay(pageType) {
    if (pageType == undefined)
        pageType = "";

    SetSessionNumber(pageType);

    if (GetSessionNumber(pageType) < 2) {
        SetCookieDays("sessionmark" + pageType, "1", 1);
    }
}

function GetSessionNumber(pageType) {
    if (pageType == undefined)
        pageType = "";

    var sessionNumber = GetCookie("sessionnum" + pageType);
    if (sessionNumber < 1 || sessionNumber == null)
        sessionNumber = SetSessionNumber(pageType);

    return sessionNumber;
}

function SetSessionNumber(pageType) {
    if (pageType == undefined)
        pageType = "";

    var sessionNumber = GetCookie("sessionnum" + pageType);

    if (sessionNumber < 1 || sessionNumber == null) {
        sessionNumber = 1;
    }
    else {
        sessionNumber++;
    }

    SetCookieDays("sessionnum" + pageType, sessionNumber, 1);

    return sessionNumber;
}
/*
    MARKING SESSION END
---------------------------------------------------------*/








function CountViews(type, id) {

    var host = "counter.one.co.il";
    /*
    if (type === "Trivia" || 
        type === "Glitch" ||
        type === "PushArticle")
        */
        host = "www.one.co.il";

    var url = "https://" + host + "/NoMobileRedirect/Views/Counter/" + type + "/" + id + "/" + Math.random().toString().split(".")[1];

    //logone("View count: " + id + ":" + type);

    new Image().src = url;
}

function CountArticleView(id) {
    CountViews("Article", id);
}

function CountGlitchView(id) {
    CountViews("Glitch", id);
}

function CountVideoView(id) {
    CountViews("Video", id);
}

function CountVideoViewVpH(id) {
    CountViews("VideoVpH", id);
}

function CountTriviaView(id) {
    CountViews("Trivia", id);
}

/*
    END COUNT VIEWS
---------------------------------------------------------*/
//////////////////////////////////////////////////
//
//
// SCROLL DOWN TO GET ORIGINAL DFP HELPERS
//
//
//////////////////////////////////////////////////
function PrepareAdsElementsForResponsiveDesign() {
    // We add special css class for Sided Towers containers.
    // 'Cos DFP takes time to render banners need to wait numbers of seconds
    // 'Cos DFP can render into containers different sized ads we need add css class that will be trigger for differenr Media Query rule
    setTimeout(function () {
        if ($j("#adLeftTower").width() > 165)
            $j("#adLeftTower").addClass("adTowerWide");
        /*
        if ($j("#adRightTower").width() > 165)
            $j("#adRightTower").addClass("adTowerWide");
        */
    }, 3000);
};

/*
 * USING OF ZEDO IS DEPRECATED
 *
 */
function ImpressionCount(id) {
    return;
    //var zzp = new Image();
    //zzp.src = "http://l4.zedo.com/log/p.gif?a=" + id + ";c=455000000;x=5632;n=455;e=i;i=0;s=0;z=" + Math.random();
}

function ImpressionCountDFP(id, iu) {
    var zzp = new Image();
    zzp.src = "http://pubads.g.doubleclick.net/gampad/clk?id=" + id + "&iu=" + iu;
}















//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//
// ORIGIAL DFP HELPERS
// 
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//
//
// POP UNDER
//
//
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////


// pop under V4.5
// In chrome open the pop under as pop-up in a new window ( using classic new window function).
// test on chrome  44.0.2403.125 m
// date: 03/08/2015



if (typeof tmo_util != "object") {
    tmo_util = {};
};
if (typeof tmo_prop != "object") {
    tmo_prop = {};
};

tmo_prop.IE = (navigator.userAgent.indexOf("MSIE") >= 0) ? true : false;
if (navigator.userAgent.indexOf(".NET4.0E; .NET4.0C;") >= 0) { tmo_prop.IE = true }
tmo_util.stlPopUnder = function (adcode, specification, Targetwindow, pop, ife, Height, Width) {
    tmo_prop.TM_PopUnder = "off";
    tmo_prop.TM_PopUnderData = adcode
    tmo_prop.TM_PopUnderHeight = Height;
    tmo_prop.TM_PopUnderWidth = Width;
    tmo_prop.TM_Targetwindow = Targetwindow
    tmo_prop.TM_PopUnderSpecification = specification
    top.isPopDone_ = false;
    window.TM_openWin = function () {
        if (tmo_prop.TM_PopUnder == "off") {
            tmo_prop.TM_PopUnder = "on"
            myWindow = window.open('', tmo_prop.TM_Targetwindow, tmo_prop.TM_PopUnderSpecification);
            myWindow.document.write('<html><head><title>&nbsp;Advertisement</title></head><body marginheight=0 marginwidth=0 leftmargin=0 topmargin=0>' + tmo_prop.TM_PopUnderData + '</body></html>');
            if (!tmo_prop.IE) {
                myWindow.window.open('about:blank').close();
            }
            if (pop = "Pop-under") {
                myWindow.blur();
                window.focus();
            }
        }
    }
    if (!tmo_prop.IE) {
        document.addEventListener("click", window.TM_openWin, false);
    }
    if (!tmo_prop.IE) {
        document.addEventListener("mouseup", function () {
            if (top.isPopDone_)
                return;
            var rand = Math.random();
            var a = document.createElement("a");
            a.href = "data:text/html," + unescape('%3Cscript%3E') + "window.close();" + unescape('%3C/script%3E'),
			document.getElementsByTagName("body")[0].appendChild(a);
            var e = document.createEvent("MouseEvents");
            e.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, true, 0, null);
            a.dispatchEvent(e);
            a.parentNode.removeChild(a);
            window.open("about:blank", "_tab" + rand.toString()).close();
            top.isPopDone_ = true;
        }, false);
    } else {
        setTimeout(window.TM_openWin, 250);
    }
}

var tm = {
    tm_pop: function (l, x) {
        var p = x.cap || 1;
        var k = x.wait || 4;
        var j = x.cookie || "__.tm";
        var y = x.width;
        var e = x.height;
        var x = "";
        var m = {
            tm_initializefun: function () {
                this.ua.tm_initializefun()
            },
            ua: {
                tm_initializefun: function () {
                    this.browser = this.tm_Stringsearchfun(this.list_browser) || "unknown";
                    this.version = this.tm_Versionsearchfun(navigator.userAgent) || this.tm_Versionsearchfun(navigator.appVersion) || "unknown";
                    this.os = this.tm_Stringsearchfun(this.list_os) || "unknown";
                    if (this.browser == "Chrome" || this.browser == "chrome") {
                        y = y || window.innerWidth;
                        e = e || window.innerHeight
                    } else if (this.browser == "Explorer" || this.browser == "explorer") {
                        y = y || window.innerWidth;
                        e = e || window.innerHeight
                    } else {
                        y = y || screen.width;
                        e = e || screen.height
                    }
                    x = "width=" + y + ",height=" + e + ",resizable=no,toolbar=no,location=no,directories=no,status=no,menubar=no,copyhistory=no,scrollbars=yes,top=0,left=0"
                },
                list_browser: [{
                    str: navigator.userAgent,
                    subStr: "Chrome",
                    id: "Chrome"
                }, {
                    str: navigator.userAgent,
                    subStr: "OmniWeb",
                    versionSearch: "OmniWeb/",
                    id: "OmniWeb"
                }, {
                    str: navigator.vendor,
                    subStr: "Apple",
                    id: "Safari",
                    versionSearch: "Version"
                }, {
                    prop: window.opera,
                    id: "Opera",
                    versionSearch: "Version"
                }, {
                    str: navigator.vendor,
                    subStr: "iCab",
                    id: "iCab"
                }, {
                    str: navigator.vendor,
                    subStr: "KDE",
                    id: "Konqueror"
                }, {
                    str: navigator.userAgent,
                    subStr: "Firefox",
                    id: "Firefox"
                }, {
                    str: navigator.vendor,
                    subStr: "Camino",
                    id: "Camino"
                }, {
                    str: navigator.userAgent,
                    subStr: "Netscape",
                    id: "Netscape"
                }, {
                    str: navigator.userAgent,
                    subStr: "MSIE",
                    id: "Explorer",
                    versionSearch: "MSIE"
                }, {
                    str: navigator.userAgent,
                    subStr: "Gecko",
                    id: "Mozilla",
                    versionSearch: "rv"
                }, {
                    str: navigator.userAgent,
                    subStr: "Mozilla",
                    id: "Netscape",
                    versionSearch: "Mozilla"
                }
                ],
                list_os: [{
                    str: navigator.platform,
                    subStr: "Win",
                    id: "Windows"
                }, {
                    str: navigator.platform,
                    subStr: "Mac",
                    id: "Mac"
                }, {
                    str: navigator.userAgent,
                    subStr: "iPhone",
                    id: "iPhone/iPod"
                }, {
                    str: navigator.platform,
                    subStr: "Linux",
                    id: "Linux"
                }
                ],
                tm_Stringsearchfun: function (l) {
                    for (var x = 0; x < l.length; x++) {
                        var p = l[x].str;
                        var k = l[x].prop;
                        this.versionSearchString = l[x].versionSearch || l[x].id;
                        if (p) {
                            if (p.indexOf(l[x].subStr) != -1) {
                                return l[x].id
                            }
                        } else {
                            if (k) {
                                return l[x].id
                            }
                        }
                    }
                },
                tm_Versionsearchfun: function (l) {
                    var x = l.indexOf(this.versionSearchString);
                    if (x == -1) {
                        return
                    }
                    return parseFloat(l.substr(x + this.versionSearchString.length + 1))
                }
            },
            cookie: {
                tm_get: function (l, x) {
                    var p = new Date;
                    p.setTime(p.getTime());
                    var k = (new Date(p.getTime() + 1e3 * 60 * 60 * x)).toGMTString();
                    var j = document.cookie.split(";");
                    var y = "";
                    var e = "";
                    var m = [0, k];
                    for (var a = 0; a < j.length; a++) {
                        y = j[a].split("=");
                        e = y[0].replace(/^\s+|\s+$/g, "");
                        if (e == l) {
                            b_cookie_found = true;
                            if (y.length > 1) {
                                m = unescape(y[1]).split("|");
                                if (m.length == 1) {
                                    m[1] = k
                                }
                            }
                            return m
                        }
                        y = null;
                        e = ""
                    }
                    return m
                },
                tm_set: function (l, x, p) {
                    document.cookie = l + "=" + escape(x + "|" + p) + ";expires=" + p + ";path=/"
                }
            },
            listener: {
                tm_addfun: function (l, x, p) {
                    var k = "on" + x;
                    if (typeof l.addEventListener != "undefined") {
                        l.addEventListener(x, p, arguments.callee)
                    }
                    else {
                        if (typeof l.attachEvent != "undefined") { l.attachEvent(k, p) }
                        else {
                            if (typeof l[k] != "function") { l[k] = p }
                            else { var j = l[k]; l["old_" + k] = j; l[k] = function () { j(); return p() } }
                        }
                    }
                },
                tm_removefun: function (l, x, p) {
                    var k = "on" + x;
                    if (typeof l.removeEventListener != "undefined") {
                        l.removeEventListener(x, p, false)
                    } else {
                        if (typeof l.detachEvent != "undefined") {
                            l.detachEvent(k, p)
                        } else {
                            if (typeof l["old_" + k] != "function") {
                                l[k] = null
                            } else {
                                l[k] = l["old_" + k]
                            }
                        }
                    }
                }
            },
            format: {},
            random: function () {
                return Math.floor(Math.random() * 1000001)
            }
        };
        m.tm_initializefun();
        m.format.popunder = {
            settings: {
                url: l,
                times: p,
                hours: k,
                cookie: j
            },
            config: x,
            isBinded: false,
            isTriggered: false,
            tm_initializefun: function () {
                var l = m.cookie.tm_get(m.format.popunder.settings.cookie, m.format.popunder.settings.hours);
                this.cookie = {};
                this.cookie.times = !isNaN(Number(l[0])) ? Number(l[0]) : 0;
                this.cookie.expires = !isNaN(Date.parse(l[1])) ? l[1] : (new Date).toGMTString();
                if (document.readyState == "complete") {
                    setTimeout(m.format.popunder.bind, 1)
                } else {
                    m.listener.tm_addfun(document, "DOMContentLoaded", function () {
                        m.listener.tm_removefun(document, "DOMContentLoaded");
                        m.format.popunder.bind()
                    });
                    m.listener.tm_addfun(document, "onreadystatechange", function () {
                        if (document.readyState == "complete") {
                            m.listener.tm_removefun(document, "onreadystatechange");
                            m.format.popunder.bind()
                        }
                    });
                    m.listener.tm_addfun(window, "load", m.format.popunder.bind)
                }
            },
            bind: function () {
                if (m.format.popunder.isBinded) {
                    return
                }
                m.format.popunder.isBinded = true;
                if (m.format.popunder.cookie.times >= m.format.popunder.settings.times) {
                    return
                }
                var l = {};
                for (var x in m.format.popunder.binders) {
                    //console.log("x="+x)
                    var p = m.format.popunder.binders[x];
                    var k = x.split("");
                    var j = "",
					y = "";
                    var e = 1,
					a;
                    for (var f = 0; f < k.length; f++) {
                        var ll = k[f];
                        if (ll.match(/[a-z0-9]/) == null) {
                            continue
                        }
                        a = ll.search(/[a-z]/) == 0;
                        if (a) {
                            if (a != e) {
                                l[j][y] = p;
                                j = ll
                            } else {
                                j += ll
                            }
                        } else {
                            if (a != e || parseInt(f) + 1 == k.length) {
                                if (a != e) {
                                    if (typeof l[j] != "object") {
                                        l[j] = {}

                                    }
                                    y = ll
                                }
                                if (parseInt(f) + 1 == k.length) {
                                    l[j][a == e ? y + ll : y] = p
                                }
                            } else {
                                y += ll
                            }
                        }
                        e = a
                    }
                }
                var c = l[m.ua.browser.toLowerCase()] || l.all;
                var h = Object.keys(c);
                h.sort();
                for (var p = 0; p < h.length; p++) {
                    var y = h[p];
                    if (m.ua.version <= y) {
                        break
                    }
                }
                c[y]()
            },
            binders: {
                chrome: function () {
                    //console.log("%%")
                },
                chrome37: function () {
                    m.listener.tm_addfun(document, "mousedown", m.format.popunder.triggers.tm_anchor_trigg)
                },
                chrome30: function () {
                    m.listener.tm_addfun(document, "click", m.ua.os == "Windows" ? m.format.popunder.triggers.tm_fullscreen_trigg : m.format.popunder.triggers.tm_triple_trigg)
                },
                chrome28: function () {
                    m.listener.tm_addfun(document, "click", m.format.popunder.triggers.tm_triple_trigg)
                },
                firefox12_chrome21: function () {
                    m.listener.tm_addfun(document, "click", m.format.popunder.triggers.tm_double_trigg)
                },
                explorer0: function () {
                    m.listener.tm_addfun(document, "click", m.format.popunder.triggers.tm_singledelay)
                },
                all0: function () {
                    m.listener.tm_addfun(document, "click", m.format.popunder.triggers.tm_single)
                }
            },
            triggers: {
                tm_fullscreen_trigg: function () {
                    m.listener.tm_removefun(document, "click", m.format.popunder.triggers.tm_fullscreen_trigg);
                    if (!m.format.popunder.tm_register_trigg()) {
                        return
                    }
                    document.documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
                    window.open(m.format.popunder.settings.url, "pu_" + m.random(), m.format.popunder.config);
                    document.webkitCancelFullScreen()
                },
                tm_triple_trigg: function () {
                    m.listener.tm_removefun(document, "click", m.format.popunder.triggers.tm_triple_trigg);
                    if (!m.format.popunder.tm_register_trigg()) {
                        return
                    }
                    window.open("javascript:window.focus()", "_self");
                    var l = window.open("about:blank", "pu_" + m.random(), m.format.popunder.config);
                    var x = document.createElement("a");
                    x.setAttribute("href", "data:text/html,<scr" + "ipt>window.close();</scr" + "ipt>");
                    x.style.display = "none";
                    document.body.appendChild(x);
                    var p = document.createEvent("MouseEvents");
                    p.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, true, 0, null);
                    x.dispatchEvent(p);
                    document.body.removeChild(x);
                    l.document.open().write("<scr" + 'ipt type="text/javascript">window.location="' + m.format.popunder.settings.url + '";</scr' + "ipt>");
                    l.document.close()
                },
                tm_anchor_trigg: function () {
                    m.listener.tm_removefun(document, "mousedown", m.format.popunder.triggers.tm_triple_trigg);
                    if (!m.format.popunder.tm_register_trigg()) {
                        return
                    }
                    var anchor = document.createElement("A");
                    //anchor.href =  m.format.popunder.settings.url;
                    //document.body.appendChild (anchor);
                    var l = window.open(m.format.popunder.settings.url, "pu_" + m.random(), m.format.popunder.config);
                    var e = document.createEvent("MouseEvents");
                    e.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, true, 0, null);
                    anchor.dispatchEvent(e);
                    anchor.parentNode.removeChild(anchor);

                },

                tm_double_trigg: function (l) {
                    m.listener.tm_removefun(document, "click", m.format.popunder.triggers.tm_double_trigg);
                    if (!m.format.popunder.tm_register_trigg() && l != "i") {
                        return
                    }
                    var x = window.open(m.format.popunder.settings.url, "pu_" + m.random(), m.format.popunder.config);
                    if (x) {
                        x.blur();
                        try {
                            var p = x.window.open("about:blank");
                            p.close()
                        } catch (k) { }
                        if (m.ua.browser == "Firefox")
                            window.showModalDialog("javascript:window.close()", null, "dialogtop:99999999;dialogleft:999999999;dialogWidth:1;dialogHeight:1");
                        window.focus()
                    }
                },
                tm_singledelay: function () {
                    m.listener.tm_removefun(document, "click", m.format.popunder.triggers.tm_singledelay);
                    if (!m.format.popunder.tm_register_trigg())
                        return;
                    var l = window.open(m.format.popunder.settings.url, "pu_" + m.random(), m.format.popunder.config);
                    window.setTimeout(window.focus, 750);
                    window.setTimeout(window.focus, 850);
                    if (l)
                        l.blur()
                },
                tm_single: function (l) {
                    m.listener.tm_removefun(document, "click", m.format.popunder.triggers.tm_single);
                    if (!m.format.popunder.tm_register_trigg() && l != "i") {
                        return
                    }
                    var x = window.open(m.format.popunder.settings.url, "pu_" + m.random(), m.format.popunder.config);
                    if (x) {
                        x.blur();
                        window.focus()
                    }
                }
            },
            tm_register_trigg: function () {
                if (m.format.popunder.isTriggered) {
                    return false
                }
                m.format.popunder.isTriggered = true;
                if (m.format.popunder.settings.hours > 0) {
                    m.cookie.tm_set(m.format.popunder.settings.cookie, ++m.format.popunder.cookie.times, m.format.popunder.cookie.expires)
                }
                return true
            }
        };
        m.format.popunder.tm_initializefun();
        if (!Object.keys) {
            Object.keys = function () {
                var l = Object.prototype.hasOwnProperty,
				x = !{
				    toString: null
				}
				.propertyIsEnumerable("toString"),
				p = ["toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "constructor"],
				k = p.length;
                return function (j) {
                    if (typeof j !== "object" && typeof j !== "function" || j === null)
                        throw new TypeError("Object.keys called on non-object");
                    var y = [];
                    for (var e in j) {
                        if (l.call(j, e)) {
                            y.push(e)
                        }
                    }
                    if (x) {
                        for (var m = 0; m < k; m++) {
                            if (l.call(j, p[m]))
                                y.push(p[m])
                        }
                    }
                    return y
                }
            }
			()
        }
    }
}

/*
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//
//
// END OF POP UNDER
//
//
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
*/
function IsCookieEnabled() {
    document.cookie = "Enabled=true";
    var cookieValid = document.cookie;

    // if retrieving the VALUE we just set actually works
    // then we know cookies enabled
    if (cookieValid.indexOf("Enabled=true") != -1)
        return true;
    else
        return false;
}

function SetCookieDays(name, value, days)        { SetCookieByTime(name, value, 1000 * 60 * 60 * 24 * days); }
function SetCookieHours(name, value, hours)      { SetCookieByTime(name, value, 1000 * 60 * 60 * hours); }
function SetCookieMinutes(name, value, minutes)  { SetCookieByTime(name, value, 1000 * 60 * minutes); }

function SetCookieByTime(name, value, expires) {
    var expdate = new Date();
    expdate.setTime(eval(expdate.getTime() + (expires)));
    document.cookie = name + "=" + escape(value) + ";expires=" + expdate.toGMTString() + ";domain=.one.co.il;path=/";
}

function GetCookie(name) {
    var dcookie = document.cookie;
    var cname = name + "=";
    var clen = dcookie.length;
    var cbegin = 0;

    while (cbegin < clen) {
        var vbegin = cbegin + cname.length;
        if (dcookie.substring(cbegin, vbegin) == cname) {
            var vend = dcookie.indexOf(";", vbegin);
            if (vend == -1)
                vend = clen;
            return unescape(dcookie.substring(vbegin, vend));
        }

        cbegin = dcookie.indexOf(" ", cbegin) + 1;
        if (cbegin == 0)
            break;
    }

    return null;
}
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Comments v5 API
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const apiComments = config.API.URL + "/Comments";
//const apiComments = "//evgeny.sites.one.co.il/json/v5/Comments";

const imgReplyIcon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAKCAYAAACE2W/HAAAAzElEQVQokZ2QL4tCURDF7dpNJpvvzZQtRkEQRO891WB5sFn2WQxWEUGjD5Q70212436HDaYFP4Bxsb0N/uddUTxw0sxvOHNyOY9CIyM28umbeUUt90GQb4amBImfAkEtKZDVOUPTs8nqD0HWbGXMxlWzseB6t8Ajk5VN2FyWr/HgIob+vggfAiwq9/9BYob+XRatzrgt9dC6LkEmDNme4H02diMpMWTF0JSN+8qUdzyeMtzQ3y5cFFjpeGdW+wTdPenbLzIyeAssNqb5fwNLcwu+tyZwAAAAAElFTkSuQmCC";

const imgThumbUpWhite = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAABLUlEQVRIie2VsW0DMQxFNYJH8Age4Ua5ETwCG+H/33mEG+FG0AiuUqdIkfKAFCmVhgxkI7blRGUIELhCePwUP3UpdQaAPYB97/keoEmqnscRwElSzTkfABgA+zOU5AnA4gXGQCUVAHNASa4joDXnfHDoLKkMgcY3gL2k2u2CW5aRVM1s15xb4o7vBsm1sUxk8bywUZfanPOhVWNmOwCTW+noE5+uunqsNtQ47LaCH9QCWNoOAcxhk01SIbn1+hDAQvKT5Et0FouSvum/CEmvJM/XXUfFc3hxFNRIbkOhJFeSp2eBj5TGJG0YNKWUnpl6N9SVTs9CSb7fgxZJleTZ/br6Js2tB2PLfA4byQ+Sb81Kl4si/rJPDjLflOKFalsUgIVb2j8CAGsfn/8YF18iAlh6Qi0OmAAAAABJRU5ErkJggg==";
const imgThumbUpBlack = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAA5ElEQVRIie2UQRGDMBREkYAEJFQCEiqhEpDwL8nu3ioBCZWAFCTgIL2ETho6EyjprX9mb8mb/T9/0zQ7y8xaAN3e88UCcJMUJAUAfRUoyaUq1Ht/XYHVoACsOpTkI4VKGk5DJU0ZdP4FNAC4FS865y6S5giYSN7jLAcAYw4tujWzNl2ZvSq6JXk/Cl3dxqTZKu/9NW39KDQAGD9sR2i+aT3T5iHfcl0NGtuv7vTTypyGdifnuoXGldq8YA1ofaeShm+AJJe8S5LLK1UAOgB9lMXsT7kiZHDOXZJE9Ym64mfzr8P1BKf9xhdvrLsYAAAAAElFTkSuQmCC";
const imgThumbDownWhite = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAABQklEQVRIie2UsW3DMBBFbwSN4BE8gkbwCBwhI1xD/v87jaARPIJG0AgugiClu5RMEVIgksCWYTYBQoCAINx/vDv+o9n/+hvL3QcAXneM8WhmllI6kZwkLZLyt72QPDe6EcC4QUmuJKcaQPKtCC8AZgABwFgOP1RAia2HLiSvkhYzM5OU28xJrpIuj1YMYNxYHaG+6TpDc4zx2A1atBPJczdojPFI8kpy6gZ194HkCmD+FUry3d2HR8EppZOkbJJySulU/UfyleQHgHkPqF5QSeYq6cUAhGrgYuIJwEFSBnDYU3ZJKEjKNysEMG8T0pTXjGYAMNaxdvdhs9QNaM12bP6FUuq5VLW2b8KulpXZ3wJrNneFd6A/evs0tEAWAMHsy+BdoPXdNNt6ujwNrbddvmeSUzdofS9vWuYBaGgsE/ZoPgEV0lMClTWJlgAAAABJRU5ErkJggg==";
const imgThumbDownBlack = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAZCAYAAADe1WXtAAAA20lEQVRIie2UwQ2DMAxFMwKjMEJGYARG6Ai+ON//1hEYgREYoSMwAhvQS0AUEUEhHCr1S75E9tN3Yse5v35DIYQKgEwhIoVzzgHwAIRkR7InOcboSXYAmlhTx1w/QxfJI8nRzFozG9bnB+OxCY3OzgBHMxuyQwE0tzhV1TIrdHabGyoiRXYoyUd2qJkNqTl9ngS+VLVMbhQ/t+i7kUoJQH2m9clUUltu4877RXdNfIdOVcvdzybhttst3NOG2+vQtVsza3NA/epO5Q6ozwqd/8urUtVyAoYQqiM1bzGCxAB/1vgLAAAAAElFTkSuQmCC";

(function ($) {
    class Comments {
        constructor(contentType, id, containerSelector, url) {
            this.ciID = id;
            this.contentType = contentType;
            this.containerSelector = containerSelector;
            this.url = url;

            this.tmplReplyBox = document.querySelector("#tmpl-one-comment-reply-box");

            this.Comments = null;
            this.ShowedComments = 0;
        }

        ReplyBox(parentID, id) {

            var ui = this.tmplReplyBox.content.cloneNode(true);

            ui.querySelector(".one-comments-reply-box").setAttribute("id", "one-comments-reply-box-" + id);

            ui.querySelector(".one-reply-name").setAttribute("id", "one-reply-name-" + id);

            var username = oneCache.Get("commentname");

            if (username !== null)
                ui.querySelector(".one-reply-name").value = username;

            ui.querySelector(".one-reply-team").setAttribute("id", "one-reply-team-" + id);
            ui.querySelector(".one-reply-flag").setAttribute("id", "one-reply-flag-" + id);
            ui.querySelector(".one-reply-flag-image").setAttribute("id", "one-reply-flag-image-" + id);

            ui.querySelector(".one-reply-text").setAttribute("id", "one-reply-text-" + id);
            ui.querySelector(".one-reply-text").setAttribute("data-comment-id", id);

            ui.querySelector(".one-reply-text").addEventListener("focus", function(event) {

                var id = this.getAttribute("data-comment-id");

                this.setAttribute("rows", 3);

                document.querySelectorAll("#one-comments-reply-box-" + id + " .one-reply-hidden").forEach(element => {
                    element.classList.remove("one-reply-hidden");
                });
                
                new TeamFlagSelector(config.Enums.Comments.FanData, id);
            });

            ui.querySelector(".send-reply").addEventListener("click", () => { objComments.Send(parentID, id); });

            ui.querySelector(".one-reply-result").setAttribute("id", "one-reply-result-" + id);

            if (id === 0) {
                document.getElementById("add-coment-container").append(ui);
                
            }
            else {
                ui.querySelector(".one-comments-reply-box").classList.add("sub-reply");
                
                document.querySelectorAll(".sub-reply").forEach(el => el.remove());

                document.querySelector("#comment-" + id + " div.one-comment-reply-box-container").append(ui);
            }

        }

        Get() {

            fetch(this.url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json"
                }
            })
                .then(function (response) {
                    if (!response.ok) {
                        $(`${objComments.containerSelector}`).html("שגיאה");
                        throw new Error('error: ' + response.status);
                    }


                    return response.json();
                })
                //.then(data => console.log("server response:", data))
                .then(json => {

                    if (json) {

                        objComments.FillContainersWithNumberOfComments(json.Data.Statistics.Comments);
                        objComments.ShowComments(json);
                    }
                })
                .catch(error => {
                    $(`${objComments.containerSelector}`).html("שגיאה");
                    console.error("Some error occurs:", error);
                });
        }

        Send(parentID, commentID) {
            if (document.querySelector("#one-reply-name-" + commentID).value.trim().length < 2) {
                alert("לא ניתן לשלוח תגובה ללא שם");
                return false;
            }

            if (document.querySelector("#one-reply-text-" + commentID).value.trim().length < 2) {
                alert("לא ניתן לשלוח תגובה ללא תוכן");
                return false;
            }

            document.querySelector("#one-comments-reply-box-" + commentID + " .eula-and-send").classList.toggle("hide");

            var model = new Object();

            model.ItemID = this.ciID;
            model.ParentID = parentID;
            model.ContentType = this.contentType;
            model.Platform = config.Platform;
            model.IP = IP;
            model.TeamID = document.querySelector("#one-reply-team-" + commentID).value;
            model.FlagID = IsNullOrEmpty(document.querySelector("#one-reply-flag-" + commentID).value) ? 0 : document.querySelector("#one-reply-flag-" + commentID).value;
            model.Author = document.querySelector("#one-reply-name-" + commentID).value;
            model.Text = document.querySelector("#one-reply-text-" + commentID).value;

            oneCache.Set("commentname", model.Author, 60 * 60 * 24 * 365);

            fetch(apiComments + "/Add/" + model.ItemID, {
            //fetch(apiComments.replace("api", "sites") + "/Add/" + model.ItemID, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(model)
            })
                .then(function (response) {
                    if (!response.ok) {
                        document.querySelector("#one-comments-reply-box-" + commentID + " .eula-and-send").classList.toggle("hide");
                        throw new Error('error: ' + response.status);
                    }
                    else
                        return response.json();
                })
                .then(function (responseData) {

                    if (responseData.Data.Result.Result) {

                        document.querySelector("#one-comments-reply-box-" + commentID + " div.one-reply-result").innerText = "תגובתך נשלחה ותפורסם בהתאם לשיקולי המערכת";
                        document.querySelector("#one-reply-text-" + commentID).value = "";
                    }
                    else {
                        document.querySelector("#one-comments-reply-box-" + commentID + " div.one-reply-result").innerText = "משהו השתבש. נסה שוב מאוחר יותר";
                    }

                    document.querySelector("#one-comments-reply-box-" + commentID + " div.one-reply-result").classList.toggle("hide");

                    return responseData;
                })
                .then(() => {

                    setTimeout(function () {

                        document.querySelector("#one-comments-reply-box-" + commentID + " .eula-and-send").classList.toggle("hide");
                        document.querySelector("#one-comments-reply-box-" + commentID + " div.one-reply-result").classList.toggle("hide");

                        if (commentID !== 0)
                            document.querySelector("#one-comments-reply-box-" + commentID).remove();

                    }, 3000);
                })
                .catch(error => console.error("Some error occurs:", error));
        }

        FillContainersWithNumberOfComments(jStat) {

            $("#item-comments-stat").html(`ישנן ${jStat.Count} תגובות ב-${jStat.Topics} דיונים`);

            let retval = "";

            if (jStat.Count === 1)
                retval = "תגובה אחת";
            else if (jStat.Count === 0)
                retval = "הוספת תגובה";
            else
                retval = "<span>" + jStat.Count + "</span> תגובות";

            $(".jump-2-comments-from-header span.put-number-of-comments-here").html(retval);

            if (jStat.Count > 0) {
                $(".jump-2-comments-from-header span.put-number-of-comments-here").addClass("add-comments-bubble-icon");
                $(".jump-2-comments-from-header").on("click", function () { gaTrackEvent('article', 'jump-2-comments-header-view'); });

                $(".jump-2-comments-from-artcile-bottom span.comments-message-left").html("<a href='#commentslist' onclick=\"gaTrackEvent('article', 'jump-2-comments-below-info-msg');\">לקריאת כל התגובות</a>");

                // Reminder for case when it will pop-up:
                // Ori decide not to put this text on mobile 
                // 'cos there is no enough space in container and he not found any solution for this
                // so text stay as is like "be first to comment"
                $(".jump-2-comments-from-artcile-bottom span.comments-message-right").html((jStat.Count === 1 ? "לכתבה זו התפרסמה " : "לכתבה זו התפרסמו ") + retval);

            }
            else {
                $(".jump-2-comments-from-header").on("click", function () { j('.one-reply-hidden').show(); gaTrackEvent('article', 'jump-2-comments-header-add'); });
                $(".jump-2-comments-from-artcile-bottom span.comments-message-right").html(config.Platform === Platform.Desktop ?
                    "לכתבה זו לא התפרסמו תגובות, היו הראשונים להגיב"
                    :
                    "הגיבו ראשונים לכתבה");
            }
        }

        ShowComments(json) {

            this.Comments = json.Data;

            var tmplComment = document.querySelector("#tmpl-comment");

            $(".data-preloader").hide();

            json.Data.Comments.forEach(jComment => {

                var node = objComments.GetCommentUI(tmplComment, jComment, 0);

                node.querySelector(".comment").classList.add("hide");

                if (jComment.Replies.length > 0) {
                    

                    const divReplies = document.createElement('div');
                    divReplies.classList.add('one-sub-comment');  // Добавляем CSS-класс
                    //newDiv.style.backgroundColor = 'lightblue';  // Устанавливаем цвет фона
                    //newDiv.style.padding = '10px';
                    divReplies.setAttribute('id', 'replies-' + jComment.ID);  // Устанавливаем ID
                    //newDiv.innerHTML = "<strong>Созданный div</strong>"; // Можно вставить HTML

                    //node.append($("<div />").addClass("replies"));

                    jComment.Replies.forEach(jSubComment => {

                        var subnode = objComments.GetCommentUI(tmplComment, jSubComment, jComment.ID);

                        divReplies.append(subnode);
                    });

                    node.querySelector(".comment").append(divReplies);
                }

                $(`${objComments.containerSelector}`).prepend(node);

            });

            objComments.ShowMore(7);
        }

        GetCommentUI(template, jComment, parentID) {
            var ui = template.content.cloneNode(true);

            ui.querySelector(".comment").classList.add("one-comment");

            ui.querySelector(".comment").classList.add("comment-id-" + jComment.ID, "parent-comment-id-" + parentID);

            ui.querySelector(".comment").setAttribute("id", "comment-" + jComment.ID);
            ui.querySelector(".comment").setAttribute("data-comment-id", jComment.ID);
            ui.querySelector(".comment").setAttribute("data-parent-comment-id", parentID);

            ui.querySelector(".one-comment-text .author").innerText = jComment.Author;
            ui.querySelector(".one-comment-text .date").innerText = dateFormat(new Date(jComment.DateTime), "dd/mm/yyyy HH:MM");
            ui.querySelector(".one-comment-text .text").innerHTML = jComment.Text;

            ui.querySelector(".reply-to-this").setAttribute("href", "javascript:objComments.ReplyBox(" + (parentID > 0 ? parentID : jComment.ID) + "," + jComment.ID + ");");

            $(ui.querySelector("span.positive-points"))
                .attr("id", "thumb-positive-" + jComment.ID)
                .data("points", jComment.Positive)
                .html(jComment.Positive);

            var imgThumbUp = imgThumbUpWhite; 
            var imgThumbDown = imgThumbDownWhite;
            var oldVote = oneCache.Get("thumb" + jComment.ID);

            if (oldVote !== null) {
                if (oldVote === 1) 
                    imgThumbUp = imgThumbUpBlack;
                else
                    imgThumbDown = imgThumbDownBlack;
            }

            ui.querySelector("span.positive-points")
                .setAttributes({
                    "id": "positive-points-" + jComment.ID,
                });
            ui.querySelector("span.positive-points").innerText = jComment.Positive;

            ui.querySelector("img.positive-thumb")
                .setAttributes({
                    "id": "positive-thumb-" + jComment.ID,
                    "src": imgThumbUp
                });
            ui.querySelector("img.positive-thumb").addEventListener("click",
                function () {
                    objComments.Rate(jComment.ID, 1);
                });



            ui.querySelector("span.negative-points")
                .setAttributes({
                    "id": "negative-points-" + jComment.ID,
                });
            ui.querySelector("span.negative-points").innerText = jComment.Negative;


            ui.querySelector("img.negative-thumb")
                .setAttributes({
                    "id": "negative-thumb-" + jComment.ID,
                    "src": imgThumbDown
                });
            ui.querySelector("img.negative-thumb").addEventListener("click",
                function () {
                    objComments.Rate(jComment.ID, -1);
                });


            if (jComment.IsEnableReply)
                $(ui.querySelector(".one-comment-number span")).html(jComment.Number);
            else
                $(ui.querySelector(".one-comment-number span")).append($("<img />").attr("src", imgReplyIcon));

            if (jComment.Team !== null) {
                $(ui.querySelector(".one-comment-team-logo img"))
                    .attr({
                        "src": config.Platform === Platform.Desktop ? jComment.Team.Image.PC : jComment.Team.Image.Mobile,
                        "alt": jComment.Team.Name.Main,
                        "title": jComment.Team.Name.Main
                    });

                if (jComment.Team.Flags.length > 0) {
                    $(ui.querySelector("img.one-comment-team-flag"))
                        .attr({
                            "src": config.Platform === Platform.Desktop ? jComment.Team.Flags[0].Image.PC : jComment.Team.Flags[0].Image.Mobile,
                            "alt": jComment.Team.Flags[0].Name.Main,
                            "title": jComment.Team.Flags[0].Name.Main
                        });
                }
            }

            return ui;
        }

        Rate(id, newVote) {

            var oldVote = oneCache.Get("thumb" + id);

            // model new (current) vote
            var mNewVote = new Object();
            mNewVote.Name = "new vote";
            mNewVote.ID = id;
            mNewVote.IP = IP;
            mNewVote.IsPositive = newVote > 0;
            mNewVote.IsAdd = oldVote === null || newVote !== oldVote;

            // model for restore values if user chnged mind (see below also) 
            var mResetVote = new Object();
            mResetVote.Name = "reset vote";
            mResetVote.IsPositive = !mNewVote.IsPositive;
            mResetVote.IsAdd = false;
            mResetVote.ID = id;
            mResetVote.IP = IP;

            // we send model to update one by one
            // first add new vote model
            var arrVotes = [];
            arrVotes.push(mNewVote);

            // if user alredy voted for this comment or changed mind send model tat will restore previous vote
            if (oldVote !== null && newVote !== oldVote)
                arrVotes.push(mResetVote);

            // so it may be one or two request
            // 1 new vote
            // 2 prev vote if exist
            arrVotes.forEach((model, i) => {

                fetch(baseapiurl + "/Rate/" + model.ID, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(model)
                })
                    .then(function (response) {
                        if (!response.ok) {
                            // throw new Error('error: ' + response.status);
                        }
                        return response.json();

                    })
                    .then(function (responseData) {

                        if (responseData.Data.Result !== null && responseData.Data.Result) {

                            oneCache.Set("thumb" + id, newVote, 60 * 60 * 24 * 60);

                            // update points in UI after each model succesed
                            var pointsSelector = (model.IsPositive ? "positive-points-" : "negative-points-") + model.ID;
                            var thumbSelector = (model.IsPositive ? "positive-thumb-" : "negative-thumb-") + model.ID;

                            var factor = model.IsAdd ? 1 : -1;
                            var points = parseInt(document.getElementById(pointsSelector).innerText, 10);
                            document.getElementById(pointsSelector).innerText = points + factor < 0 ? 0 : points + factor;

                            // update thumbs ui only for new vote model
                            if (i === 0) {
                                document.getElementById("positive-thumb-" + id).setAttribute("src", imgThumbUpWhite);
                                document.getElementById("negative-thumb-" + id).setAttribute("src", imgThumbDownWhite);

                                if (model.IsAdd)
                                    document.getElementById(thumbSelector).setAttribute("src", model.IsPositive ? imgThumbUpBlack : imgThumbDownBlack);
                                else
                                    oneCache.Remove("thumb" + id);
                            }
                        }

                    })
                    .catch(error => console.error("Some error occurs:", error));
            });


        }

        ShowMore(num) {

            this.ShowedComments += num;

            document.querySelectorAll("#item-comments > .comment").forEach((el, i) => {
                if (i < this.ShowedComments)
                    el.classList.remove("hide");
            });

            document.querySelector("#show-more-comments").style.display = this.Comments.Statistics.Comments.Topics > this.ShowedComments ? "block" : "none";
            
        }
    }

    window.Comments = Comments;

})(jQuery);

class TeamFlagSelector {
    constructor(data, id) {

        this.data = data;
        this.teamListbox = document.getElementById("one-reply-team-" + id);
        this.flagListbox = document.getElementById("one-reply-flag-" + id);
        this.flagImage = document.getElementById("one-reply-flag-image-" + id);

        this.populateTeams();

        this.flagImage.style.display = "none";

        this.teamListbox.addEventListener('change', () => this.handleTeamChange());

        this.keySelectedTeam = "oneUserFanTeam";
        this.keySelectedFlag = "oneUserFanFlag";

        this.restoreSelection();
    }

    populateTeams() {
        const defaultOption = document.createElement('option');
        defaultOption.textContent = 'סמל קבוצה';
        defaultOption.value = '0';
        this.teamListbox.appendChild(defaultOption);

        this.data.Sports.forEach(sport => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = sport.Name.Main;

            sport.Teams.forEach(team => {
                const option = document.createElement('option');
                option.value = team.ID;
                option.textContent = team.Name.Main;
                option.dataset.imagePC = team.Image.PC;
                option.dataset.imageMobile = team.Image.Mobile;
                option.dataset.flags = JSON.stringify(team.Flags);
                optgroup.appendChild(option);
            });

            this.teamListbox.appendChild(optgroup);
        });
    }

    handleTeamChange() {
        const selectedValue = this.teamListbox.value;
        localStorage.setItem(this.keySelectedTeam, selectedValue);
        this.populateFlags();
    }

    populateFlags() {
        this.flagListbox.innerHTML = '';
        const selectedOption = this.teamListbox.options[this.teamListbox.selectedIndex];
        const flags = selectedOption.value ? JSON.parse(selectedOption.dataset.flags) : [];

        this.flagImage.style.display = "none";

        if (flags.length === 0) {
            this.flagListbox.style.display = 'none';
            return;
        }

        this.flagListbox.style.display = 'block';
        const defaultOption = document.createElement('option');
        defaultOption.textContent = 'בחר דגל';
        defaultOption.value = '0';
        this.flagListbox.appendChild(defaultOption);

        flags.forEach(flag => {
            const option = document.createElement('option');
            option.value = flag.ID;
            option.dataset.imagePC = flag.Image.PC;
            option.dataset.imageMobile = flag.Image.Mobile;
            option.textContent = flag.Name.Main;
            this.flagListbox.appendChild(option);
        });

        const savedFlag = localStorage.getItem(this.keySelectedFlag);
        if (savedFlag) this.flagListbox.value = savedFlag;

        this.flagListbox.addEventListener('change', () => {
            this.showFlag();
            localStorage.setItem(this.keySelectedFlag, this.flagListbox.value);
        });
    }

    restoreSelection() {
        const savedTeam = localStorage.getItem(this.keySelectedTeam);
        if (savedTeam) {
            this.teamListbox.value = savedTeam;
            this.populateFlags();

            this.showFlag();
        }
    }

    showFlag() {
        const selectedOption = this.flagListbox.options[this.flagListbox.selectedIndex];

        if (!selectedOption || selectedOption.value === "0") {
            this.flagImage.style.display = "none";
            this.flagImage.src = "";
            return;
        }

        const imagePC = selectedOption.dataset.imagePC;
        this.flagImage.src = imagePC;
        this.flagImage.style.display = "block";
    }
}

























































/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Comments v3
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let baseapiurl = config.API.URL + "/Comments";
var refToMainReplyBox = null;
var refToCurrentReplyBox = null;

var objCommentRater;

var commentBoxTemplate = "";

function ReplyToThis(parentID, id) {

    $j("div.one-comments-reply-to-this").html("");

    var options =
        {
            'id': id,
            'parentID': parentID,
            'elementID': oneItemid,
            'type': oneContentType,
            'platform': onePlatform
        };

    refToCurrentReplyBox = new CommentBox(options);
    refToCurrentReplyBox.Show();
}

var CommentBox = function (options) {
    this.init(options);
};

jQuery.extend(CommentBox.prototype, {

    init: function (options) {

        this.id = options.id;
        this.parentContainer = "#one-comments-reply-box" + (this.id === 0 ? "" : this.id) + " ";
        this.parentCommentID = options.parentID;

        this.contentElementID = options.elementID;
        this.contentType = options.type;
        this.platform = options.platform;
    },

    CommenterTeamChanged: function (team_id) {

        this.SetSignatureSelect(team_id);
    },

    SetSignatureSelect: function (team_id) {

        var sigSelector = $j(this.parentContainer + "select.one-reply-signature");

        $j(sigSelector).html("<option value='0'>בחר דגל</option>");

        $j(this.parentContainer + "img.one-reply-signature-image").hide();

        var isTeamHaveSignatures = false;

        $j.each(signatures.Rows, function (i, sig) {

            if (parseInt(sig.Team_Id, 10) === parseInt(team_id, 10) ) {

                isTeamHaveSignatures = true;
                $j(sigSelector).append("<option value='" + sig.Id + "'>" + sig.Description + "</option>");

            }
        });

        //dont show flag row if this team doesnt have signatures
        if (isTeamHaveSignatures)
            $j(this.parentContainer + "select.one-reply-signature").show();
    },

    SignatureChanged: function (sigId) {
        var fileName = "";

        $j.each(signatures.Rows, function (i, sig) {
            if (sig.Id === sigId) {

                fileName = this.platform == 0 ?
                    "https://images.one.co.il/images/comments/signatures/" + sig.FileName :
                    "https://images.one.co.il/images/comments/signatures/mobile/" + sig.FileName_Mobile;

                return;
            }
        });

        if (fileName.length > 1)
            $j(this.parentContainer + "img.one-reply-signature-image").attr("src", fileName.toLowerCase()).show();
        else
            $j(this.parentContainer + "img.one-reply-signature-image").hide();
    },

    SubmitComment: function () {

        if ($j(this.parentContainer + "input.one-reply-name").val().trim().length < 2) {
            alert("לא ניתן לשלוח תגובה ללא שם");
            return false;
        }

        if ($j(this.parentContainer + "textarea.one-reply-text").val().trim().length < 2) {
            alert("לא ניתן לשלוח תגובה ללא תוכן");
            return false;
        }


        var model = new Object();

        model.ItemID = this.contentElementID;
        model.ParentID = this.parentCommentID;
        model.ContentType = this.contentType;
        model.Platform = config.Enums.Platform;
        model.IP = IP;
        model.TeamID = $j(this.parentContainer + "select.one-reply-team").val();
        model.FlagID = $j(this.parentContainer + "select.one-reply-signature").val() === null ? 0 : $j(this.parentContainer + "select.one-reply-signature").val();
        model.Author = $j(this.parentContainer + "input.one-reply-name").val();
        model.Text = $j(this.parentContainer + "textarea.one-reply-text").val();

        var commentID = this.id > 0 ? this.id : "";

        fetch(baseapiurl + "/Add/" + model.ItemID, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(model)
        })
            .then(function (response) {
                if (!response.ok) {
                   // throw new Error('error: ' + response.status);
                }
                return response.json();
            })
            //.then(data => console.log("server response:", data))
            .then(function (responseData) {

                if (responseData.Data.Result) {
                    $j("#one-comments-reply-box" + commentID + " div.one-reply-result").show();

                    $j("#one-comments-reply-box" + commentID + " input, #one-comments-reply-box" + commentID + " select, #one-comments-reply-box" + commentID + " textarea").prop("disabled", true);

                    setTimeout(function () {
                        $j("#one-comments-reply-box" + commentID + " div.one-reply-result").hide();

                        $j("#one-comments-reply-box" + commentID + " input, #one-comments-reply-box" + commentID + " select, #one-comments-reply-box" + commentID + " textarea").prop("disabled", false);

                        $j("#one-comments-reply-box" + commentID + " input[type='text'], #one-comments-reply-box" + commentID + " textarea").val("");
                        $j("#one-comments-reply-box" + commentID + " select").val(0).trigger("change");

                        if (commentID > 0) {
                            $j("#one-comments-reply-box" + commentID).html("");
                        }
                    }, 3000);
                }
            })
            .catch(error => console.error("Some error occurs:" , error));
    },

    Show: function () {

        $j(this.parentContainer).html(commentBoxTemplate);
    }
});


function ShowMoreComments(num) {

    

    $j(".show-more-comments").blur();

    numberOfShowedComments += num;


    $j(".one-comment").each(function (i, obj) {

        if (i >= numberOfShowedComments)
            return;

        var cid = $j(obj).data("comment-id");

        $j("div[class*='comment-id-" + cid + "']").show();
        $j("div[class*='comment-id-" + cid + "']").next().show();

    });

    if (numberOfShowedComments > numberOfComments) {
        $j(".show-more-comments").hide();
        return;
    }
}















var CommentRating = function (elementType, elementID) {
    this.init(elementType, elementID);
};

jQuery.extend(CommentRating.prototype, {

    init: function (elementType, elementID) {

        this.objectName = "cmntRate" + elementType + "" + elementID;

        var coo = GetCookie(this.objectName);

        this.data = coo === null ? {} : JSON.parse(coo);
    },

    Rate: function (newVote, id) {

        var jVote = {
            'id': id,
            'isAddPositive': false,
            'isSubPositive': false,
            'isAddNegative': false,
            'isSubNegative': false,
            'point': 0
        };

        var currentVote = this.data.hasOwnProperty(id) ? this.data[id] : 0;

        if (currentVote === 0) {
            jVote.point = newVote;
            if (newVote > 0) {
                jVote.isAddPositive = true;

                this.AddPoint("#thumb-positive-" + jVote.id, 1);
            }
            if (newVote < 0) {
                jVote.isAddNegative = true;

                this.AddPoint("#thumb-negative-" + jVote.id, 1);
            }
        }

        if (newVote === -1 && currentVote === -1) {
            jVote.point = 0;
            jVote.isSubNegative = true;

            this.AddPoint("#thumb-negative-" + jVote.id, -1);
        }

        if (newVote === 1 && currentVote === 1) {
            jVote.point = 0;
            jVote.isSubPositive = true;

            this.AddPoint("#thumb-positive-" + jVote.id, -1);
        }

        if (newVote === 1 && currentVote === -1) {
            jVote.point = newVote;
            jVote.isSubNegative = true;
            jVote.isAddPositive = true;

            this.AddPoint("#thumb-positive-" + jVote.id, 1);
            this.AddPoint("#thumb-negative-" + jVote.id, -1);
        }

        if (newVote === -1 && currentVote === 1) {
            jVote.point = newVote;
            jVote.isSubPositive = true;
            jVote.isAddNegative = true;

            this.AddPoint("#thumb-positive-" + jVote.id, -1);
            this.AddPoint("#thumb-negative-" + jVote.id, 1);
        }



        this.data[id] = jVote.point;



        var model = new Object();

        model.ID = jVote.id;
        model.IP = IP;

        if (jVote.isAddPositive) {
            model.IsPositive = model.IsAdd = isAdd = true;
        }
        if (jVote.isAddNegative) {
            model.IsPositive = false;
            model.IsAdd = true;
        }
        if (jVote.isSubPositive) {
            model.IsPositive = true;
            model.IsAdd = false;
        }
        if (jVote.isSubNegative) {
            model.IsPositive = false;
            model.IsAdd = false;
        }

        let thisObject = this;

        fetch(baseapiurl + "/Rate/" + model.ID, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(model)
        })
            .then(function (response) {
                if (!response.ok) {
                    // throw new Error('error: ' + response.status);
                }
                return response.json();

            })
            //.then(data => console.log("server response:", data))
            .then(function (responseData) {

                if (responseData.Data.Result !== null) {
                    logone("updating UI");
                    thisObject.UpdateUI(false);
                    thisObject.Save();
                }
                
            })
            .catch(error => console.error("Some error occurs:", error));
        
        

        /*
        logone(url);
        logone(JSON.stringify(model));

        jQuery.ajax({
            url: commentsServer + '/Rate',
            type: "POST",
            dataType: "json",
            data: "{'data': '" + JSON.stringify(jVote) + "'}",

            contentType: "application/json; charset=utf-8"
        });
        
        this.UpdateUI(false);

        this.Save();
        */
    },

    UpdateUI: function (isUpdatePoints) {
        jQuery.each(this.data, function (key, value) {

            $j("#icon-negative-" + key).attr("src", imgThumbDownWhite);
            $j("#icon-positive-" + key).attr("src", imgThumbUpWhite);

            if (value === -1) {

                $j("#icon-negative-" + key).attr("src", imgThumbDownBlack);

                if (isUpdatePoints)
                    objCommentRater.AddPoint("#thumb-negative-" + key, 1);
            }
            if (value === 1) {

                $j("#icon-positive-" + key).attr("src", imgThumbUpBlack);

                if (isUpdatePoints)
                    objCommentRater.AddPoint("#thumb-positive-" + key, 1);
            }
        });
    },

    AddPoint: function (id, val) {

        var obj = $j(id);

        var points = parseInt(obj.data("points"), 10);

        points += val;

        obj.data("points", points).html(points);
    },

    Save: function () {
        SetCookieDays(this.objectName, JSON.stringify(this.data), 15);
    }
});
function RedirectionMobile() {
    if (IsMobilePhone()) {
        if (window.location.toString().indexOf('iphonewww=0') < 0) {


            if (GetCookie("iphonewww") != "1") {
                SetCookieDays("iphonewww", "0", 1);

                var mobURL = GetMobileURL();

                if (mobURL.indexOf("nomobileredirect") < 0)
                    window.location = mobURL;
            }
        }
        else {
            SetCookieDays("iphonewww", "1", 1);
        }
    }
}

function GetMobileURL(oneUrl) {

    var retVal = "https://m.one.co.il/Mobile";
    var mDomain = "https://m.one.co.il/Mobile";

    var url = oneUrl || window.location.toString().toLowerCase();

    console.log("ONE Redirect: Original URL: " + url);

    // Article
    if (url.toLowerCase().indexOf("/article/") > -1) {
        return url.replace(/http:\/\/.*[.]{0,1}one.co.il\/article\//ig, mDomain + "/Article/");
    }

    // VOD
    if (url.toLowerCase().indexOf("/vod/") > -1) {
        return url.replace(/http:\/\/.*[.]{0,1}one.co.il\/vod\//ig, mDomain + "/VOD/");
    }

    

    if (url.toLowerCase().indexOf("\/video\/first.aspx") > -1) {
        var retval = url.replace(/\/cat\//ig, "/");
        retval = retval.replace(/first\.aspx/ig, "default.aspx");

        console.log("ONE Redirect: VOD first replace: " + retVal);

        retval = retval.replace(/http:\/\/.*[.]{0,1}one.co.il\/cat\/video\//ig, mDomain + "/video/");

        console.log("ONE Redirect: VOD second replace: " + retVal);

        return retval;
    }

    


    if (url.toLowerCase().indexOf("/glitches/") > -1) {
        return mDomain + "/Glitches/Glitches.aspx";
    }

    if (url.toLowerCase().indexOf("/glitch/") > -1) {

        var myregexp = /\/glitch\/([\d]+)\//i;
        var match = myregexp.exec(url);
        result = (match != null) ? match[1] : "";

        return mDomain + "/Glitches/Glitch.aspx?id=" + result;
    }

    if (url.toLowerCase().indexOf("oppinion/") > -1) {
        var myregexp = /\/oppinion\/([\d]+)\/([\d]+)/i;
        var match = myregexp.exec(url);
        result = (match != null) ? match[2] : "";

        return mDomain + "/Articles/Article.aspx?id=" + result;
    }

    // Leagues
    if (url.toLowerCase().indexOf("league/") > -1) {
        return url.replace(/http:\/\/.*[.]{0,1}one.co.il\/league\//ig, mDomain + "/League/");
    }



    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////
    // 
    // OLD
    //
    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////


    // Glitches

    //retVal = getMobileSuffix(retVal, url, /.*?article.*?\/([\d]+)\.html/ig, "Articles/Article.aspx?id=$1");
    //retVal = getMobileSuffix(retVal, url, /.*?Article(.*)?\/([\d]+)\.html[?]*(.+)*/ig, "Article/$1/$2.html?$3");

    // League news
    retVal = getMobileSuffix(retVal, url, /.*League\/Current\/([\d]+),([\d]+),([\d]+),([\d]+)\/.+/ig, "Articles/articles.aspx??title=1&c=$1&t=$2");
    // Live
    retVal = getMobileSuffix(retVal, url, /.*\/live\/.*/ig, "Live/Live.aspx");

    //retVal = getMobileSuffix(retVal, url, /.*?article.aspx\?id=([\d]+)/ig, "Articles/Article.aspx?id=$1");
    retVal = getMobileSuffix(retVal, url, /.*?oppinion.*?\/([\d]+)\.html/ig, "Articles/Article.aspx?id=$1");
    //retVal = getMobileSuffix(retVal, url, /.*InsideArticle\.aspx\?id=([\d]+).*/ig, "Articles/Article.aspx?id=$1");
    retVal = getMobileSuffix(retVal, url, /.*PersonalColumn\.aspx\?id=([\d]+).*/ig, "Articles/Article.aspx?id=$1");
    retVal = getMobileSuffix(retVal, url, /.*7,801,0,0.*/ig, "Articles/articles.aspx?t=801&title=1");


    retVal = getMobileSuffix(retVal, url, /.*\/winner\/.*/ig, "winner/winner.aspx");

    retVal = getMobileSuffix(retVal, url, /.*\/cat\/video\/[?first.aspx?c=]*([\d]+)/ig, "video/default.aspx?cat=$1");
    retVal = getMobileSuffix(retVal, url, /.*\/cat\/video[\/]*$/ig, "video/default.aspx");

    retVal = getMobileSuffix(retVal, url, /.*Team\/Current.*\/.*?,([\d]+),([\d]+).*/ig, "Leagues/Team.aspx?tid=$2");
    retVal = getMobileSuffix(retVal, url, /.*Player\/Current.*\/.*?([\d]+),([\d]+),([\d]+),([\d]+).*/ig, "general/player.aspx?pid=$4&tid=$3");

    if (
            url.indexOf("preview.aspx") > -1 ||
            url.indexOf("playbyplay.aspx") > -1 ||
            url.indexOf("bestof.aspx") > -1 ||
            url.indexOf("isf.one.co.il") > -1 ||
            url.indexOf("isa.one.co.il") > -1 ||
            url.indexOf("ibba.one.co.il") > -1 ||
            url.indexOf("olympic.one.co.il") > -1 ||
            url.indexOf("bestof.aspx") > -1 ||

            url.indexOf("mmm") > -1 ||
            url.indexOf("tools") > -1 ||
            url.indexOf("boffice") > -1

            ||

            (
                (url.toLowerCase().indexOf("sites.one.co.il") > -1 || url.toLowerCase().indexOf("extra.one.co.il") > -1

                )
                &&
                (url.toLowerCase().indexOf("tableid=100") < 0 && url.toLowerCase().indexOf("t=100") < 0)
            )
        )
        return url + "&nomobileredirect=1";

    return retVal + (GetQueryString("app") == "1" || GetQueryString("amp;app") == "1" ? "&app=1" : "");
}

function getMobileSuffix(retVal, url, regex, template) {
    if (retVal == "https://m.one.co.il/Mobile/") {
        if (url.match(regex)) {
            retVal += url.replace(regex, template);
        }
    }
    return retVal;
}


///
/// Mobile Section
///
function DeviceSelect() {
    if (navigator.userAgent.match(/Android/i)) { return "android" }
    else if (navigator.userAgent.match(/BlackBerry/i)) { return "blackberry" }
    else if (navigator.userAgent.match(/iPhone/i)) { return "iphone" }
    else if (navigator.userAgent.match(/iPad/i)) { return "ipad" }
    else if (navigator.userAgent.match(/iPod/i)) { return "ipod" }
    else if (navigator.userAgent.match(/IEMobile/i)) { return "iemobile" }
    else if (navigator.userAgent.match(/Macintosh/i)) { return "macintosh" }
    else { return "PC" }
}

function IsIphone() {
    return DeviceSelect() == "iphone" ? true : false;
}

function IsIpad() {
    return DeviceSelect() == "ipad" ? true : false;
}

function IsAndroid() {
    return DeviceSelect() == "android" ? true : false;
}

function IsMobilePhone() {
    return IsIphone() || IsAndroid() ? true : false;
}
/// <reference path="/js/jquery/jquery-1.9.1.js" />

if (window.ArenaEvents === undefined) {
    window.ArenaEvents = (function ($) {
        "use strict";

        var ArenaEvents = function () { };

        ArenaEvents.Type = function (id, name, url) {
            this.Id = id;
            this.Name = name;
            this.imageURL = url;
        };

        ArenaEvents.prototype.Types = [
            new ArenaEvents.Type(undefined, "בחר סוג אירוע", undefined),
            new ArenaEvents.Type(1, "שער", "https://images.one.co.il/images/msites/2017/12/25/goal.svg"),
            new ArenaEvents.Type(2, "שער בפנדל", "https://images.one.co.il/images/msites/2017/12/25/penalty.svg"),
            new ArenaEvents.Type(3, "שער עצמי", "https://images.one.co.il/images/msites/2017/12/25/goal.svg"),
            new ArenaEvents.Type(4, "החמצה", "https://images.one.co.il/images/msites/2017/12/25/miss.svg"),
            new ArenaEvents.Type(5, "החמצת פנדל", "https://images.one.co.il/images/msites/2017/12/25/penalty_miss.svg"),
            new ArenaEvents.Type(6, "כרטיס צהוב", "https://images.one.co.il/images/msites/2017/12/25/yellow_card.svg"),
            new ArenaEvents.Type(7, "כרטיס צהוב שני", "https://images.one.co.il/images/msites/2018/03/27/second_yellow_card.svg"),
            new ArenaEvents.Type(8, "כרטיס אדום", "https://images.one.co.il/images/msites/2017/12/25/red_card.svg"),
            new ArenaEvents.Type(9, "חילוף", "https://images.one.co.il/images/msites/2017/12/25/substitute.svg"),
            new ArenaEvents.Type(10, "נבדל", "https://images.one.co.il/images/msites/2017/12/25/offside.svg"),
            new ArenaEvents.Type(11, "החלטת שופט", "https://images.one.co.il/images/msites/2017/12/25/judge.svg"),
            new ArenaEvents.Type(12, "פציעה", "https://images.one.co.il/images/msites/2017/12/25/injury.svg"),
            new ArenaEvents.Type(13, "אחר", "https://images.one.co.il/images/msites/2017/12/25/other.svg")
        ];

        return new ArenaEvents();
    }(jQuery));
}

window.Lineup = (function ($) {
    "use strict";

    var lineup = function (homeTeam, guestTeam) {


        var self = this,
            $lineup = $(".lineup"),
            $lineupHeader = $lineup.prev(),
            $homeField = $lineup.find(".home .field"),
            $guestField = $lineup.find(".guest .field"),
            $homeBech = $lineup.find(".home .bench"),
            $guestBench = $lineup.find(".guest .bench"),
            $events = $(".arena-events .event");


        function _trimPlayerName(playerName) {
            if (playerName === undefined) {
                return "";
            }

            var firstSpace = playerName.indexOf(" ");
            return playerName.substr(firstSpace + 1);
        }

        function _buildPlayerUI($container, team, roleId) {
            var player = team.Players[roleId],
                $player = $("<div class=\"player\" />"),
                type = lineup.types[team.Tactic()];

            if (player === undefined || player === null) {
                return;
            }

            if (type.position.length > roleId) {

                var position = type.position[roleId];
                var offsetX = "14%"; // it must be half of width of player container
                var offsetY = "2%"; // it offset just for manager and old arena style

                //logone(container);

                $player.css({
                    "left": `calc(${position.x}% - ${offsetX})`,
                    "top": `calc(${position.y}% - ${offsetY})`
                });

                //$player.css(type.position[roleId]);
            }

            var shirtOrPhoto = "<img src=\"https://images.one.co.il/images/msites/2018/10/02/" + (roleId === 1 ? 16 : team.Shirt()) + ".svg\" class=\"shirt\" />";

            if (player.Photo !== undefined &&
                player.Photo.URL !== undefined &&
                player.Photo.URL["OneImage"] !== undefined)
                shirtOrPhoto = "<img src=\"" + player.Photo.URL["OneImage"]+ "\" class=\"one-lineup-photo\" />";

            $player
                //.append("<img src=\"https://images.one.co.il/images/msites/2017/12/30/" + (roleId === 1 ? 16 : team.Shirt()) + ".png\" class=\"shirt\" />")
                //.append("<img src=\"https://images.one.co.il/images/msites/2018/10/02/" + (roleId === 1 ? 16 : team.Shirt()) + ".svg\" class=\"shirt\" />")

                .append(shirtOrPhoto)

                .append("<br />")
                .append("<span class=\"name\">" + _trimPlayerName(player.Name) + "</span>")
                .appendTo($container);

            var pGrade = 0;

            if (player.Statistics !== undefined && player.Statistics.Player !== undefined && player.Statistics.Player.Grade !== undefined)
                pGrade = player.Statistics.Player.Grade;
            else
                if (player.Grade !== undefined)
                    pGrade = player.Grade;

            if ( pGrade > 0) {
                $player.append("<div class=\"grade\"\>" + pGrade + "</div>");
            }

            if (player.Card !== undefined) {
                $("<img />")
                    .attr("src", player.Card.imageURL)
                    .attr("alt", player.Card.Name)
                    .addClass("card")
                    .appendTo($player);
            }

            if (player.InAt !== undefined) {
                $("<div class=\"substitution\"\>(" + player.InAt + ")</div>")
                    .append("<img src=\"https://images.one.co.il/images/msites/2017/12/31/substitute_in.svg\" class=\"icon\" />")
                    .appendTo($player);
            }

            if (player.OutAt !== undefined) {
                $("<div class=\"substitution\"\>(" + player.OutAt + ")</div>")
                    .append("<img src=\"https://images.one.co.il/images/msites/2017/12/31/substitute_out.svg\" class=\"icon\" />")
                    .appendTo($player);
            }
        }

        this.Home = homeTeam;
        this.Guest = guestTeam;

        if ($lineup.length === 0) {
            return;
        }

        if (//homeTeam.Players.length === 1 || guestTeam.Players.length === 1 ||
            homeTeam.Tactic() === undefined || guestTeam.Tactic() === undefined) {
            $lineupHeader.hide();
            $lineup.hide();
            return;
        }

        $events.each(function () {
            var $event = $(this),
                type = window.ArenaEvents.Types[$event.data("eventType")],
                gameMinute = $event.data("gameMinute"),
                teamId = $event.data("teamId"),
                playerId = $event.data("playerId"),
                playerOutId = $event.data("playerOutId"),
                team = self.Home.Id() === teamId ? self.Home : self.Guest,
                player = team.Players.find(function (player) {
                    return player !== null && player.ID === playerId;
                });

            if (player === undefined)
                return;
            
            switch (type.Id) {
                case 6:
                case 7:
                case 8:
                    if (player.Card === undefined || player.Card.Id < type.Id) {
                        player.Card = type;
                    }
                    break;
                case 9:
                    player.InAt = gameMinute;

                    player = team.Players.find(function (player) {
                        return player !== null && player.ID === playerOutId;
                    });

                    if (player !== undefined) {
                        player.OutAt = gameMinute;
                    }
                    break;
            }
        });

        $homeField.empty();
        $guestField.empty();

        if (self.Home.Players.length > 10)
            $j("<span class=\"tactic-visual-name\"></span>").html(lineup.types[self.Home.Tactic()].type).appendTo($homeField);

        if (self.Guest.Players.length > 10)
            $j("<span class=\"tactic-visual-name\"></span>").html(lineup.types[self.Guest.Tactic()].type).appendTo($guestField);


        Object.keys(self.Home.Players).forEach(function (roleId) {
            var playerPlace = roleId < 12 ? $homeField : $homeBech;
            _buildPlayerUI(playerPlace, self.Home, roleId);

            if (roleId > 11 && self.Home.Players[roleId] !== null) {
                $homeBech.css({ display: "flex" });
                $guestBench.css({ display: "flex" });
            }
        });

        Object.keys(self.Guest.Players).forEach(function (roleId) {
            var playerPlace = roleId < 12 ? $guestField : $guestBench;
            _buildPlayerUI(playerPlace, self.Guest, roleId);

            if (roleId > 11 && self.Guest.Players[roleId] !== null) {
                $homeBech.css({ display: "flex" });
                $guestBench.css({ display: "flex" });
            }
        });
    };

    lineup.Team = function (teamId, tactic, shirt, players) {
        var self = this;

        this.Id = function () {
            return teamId;
        };
        this.Tactic = function () {
            return tactic;
        };
        this.Shirt = function () {
            return shirt;
        };
        this.Players = [null].concat(players);
    };

    lineup.types = [
        undefined,
        {
            "type": "4-4-2",
            "position": [
                undefined,
                { x: 50, y: 3 },

                { x: 37, y: 30 },
                { x: 62, y: 30 },
                { x: 12, y: 30 },
                { x: 87, y: 30 },

                { x: 37, y: 60 },
                { x: 62, y: 60 },
                { x: 12, y: 60 },
                { x: 87, y: 60 },

                { x: 37, y: 90 },
                { x: 62, y: 90 }
            ]
        },
        {
            "type": "4-3-3",
            "position": [
                undefined,


                { x: 50, y: 3 },

                { x: 37, y: 30 },
                { x: 62, y: 30 },
                { x: 12, y: 30 },
                { x: 87, y: 30 },

                { x: 25, y: 60 },
                { x: 50, y: 60 },
                { x: 75, y: 60 },

                { x: 25, y: 90 },
                { x: 75, y: 90 },
                { x: 50, y: 90 }
            ]
        },
        {
            "type": "4-5-1",
            "position": [
                undefined,
                { x: 50, y: 3 },

                { x: 37, y: 30 },
                { x: 62, y: 30 },
                { x: 12, y: 30 },
                { x: 87, y: 30 },

                { x: 30, y: 60 },
                { x: 70, y: 60 },
                { x: 10, y: 60 },
                { x: 50, y: 60 },
                { x: 90, y: 60 },

                { x: 50, y: 90 }
            ]
        },
        {
            "type": "3-5-2",
            "position": [
                undefined,
                { x: 50, y: 3 },
                
                { x: 50, y: 30 },
                { x: 25, y: 30 },
                { x: 75, y: 30 },
                
                { x: 30, y: 60 },
                { x: 70, y: 60 },
                { x: 10, y: 60 },
                { x: 50, y: 60 },
                { x: 90, y: 60 },
                
                { x: 37, y: 90 },
                { x: 62, y: 90 }
            ]
        },
        {
            "type": "5-4-1",
            "position": [
                undefined,
                { x: 50, y: 3 },

                { x: 30, y: 30 },
                { x: 50, y: 30 },
                { x: 70, y: 30 },
                { x: 10, y: 30 },
                { x: 90, y: 30 },

                { x: 37, y: 60 },
                { x: 62, y: 60 },
                { x: 12, y: 60 },
                { x: 87, y: 60 },

                { x: 50, y: 90 }
            ]
        },
        {
            "type": "5-3-2",
            "position": [
                undefined,
                { x: 50, y: 3 },

                { x: 30, y: 30 },
                { x: 50, y: 30 },
                { x: 70, y: 30 },
                { x: 10, y: 30 },
                { x: 90, y: 30 },

                { x: 25, y: 60 },
                { x: 75, y: 60 },
                { x: 50, y: 60 },

                { x: 37, y: 90 },
                { x: 63, y: 90 }
            ]
        },
        {
            "type": "4-2-3-1",
            "position": [
                undefined,
                { x: 50, y: 3 },

                { x: 12, y: 20 },
                { x: 37, y: 20 },
                { x: 62, y: 20 },
                { x: 87, y: 20 },

                { x: 37, y: 40 },
                { x: 62, y: 40 },

                { x: 25, y: 60 },
                { x: 50, y: 60 },
                { x: 75, y: 60 },

                { x: 50, y: 90 }
            ]
        }
    ];

    return lineup;
}(jQuery));
////////////////////////////////////////////////////////////////////////////////////////////////////////
//  OneVote Class
//
//  To use it invoke window.OneVote.Init method and pass it jQuery selector for vote containers.
//  Each vote container must includ data-vote-id attribute with Id of vote you want to show.
//
//  Exemple:
//  <script>
//      $(function () {
//          window.OneVote.Init(".article-vote")
//      });
//  </script>
//  <div class="article-vote" data-vote-id="1"></div>

(function ($) {
    window.OneVote = (function () {
        var OneVote = function () {
            var self = this,
                isJSONP = true,    ////////////////// Set this to false to disable JSONP requests
                $voteTamplate,
                $answerTamplate;

            function _addIconsToBank($svg) {
                var $iconBank = $(".icon-bank");

                if ($iconBank.length < 1) {
                    $iconBank = $("<div class=\"icon-bank\" style=\"display:none;\" />").appendTo("body");
                }

                $svg.appendTo($iconBank);
            }

            function _getImageURL(voteType, imageType, url) {

                var width= 0;

                switch (imageType) {
                    case window.OneVote.ImageTypes.Vote:
                        switch (voteType) {
                            case window.OneVote.VoteTypes.HomePage:
                                width = 361;
                                break;
                        }
                        break;
                    case window.OneVote.ImageTypes.Answer:
                        switch (voteType) {
                            case window.OneVote.VoteTypes.HomePage:
                                width = 85;
                                break;
                            case window.OneVote.VoteTypes.Article:
                                width = 181;
                                break;
                        }
                        break;
                }

                if (width > 0)
                    url += "?width=" + width;

                return url;
            }

            function _fixServerJSON(json) {
                /// <summary>Converts null valeus to undefined and converts dates</summary>
                /// <param name="row" type="Object">JSON that represents row</param>
                /// <returns type="Object" />
                Object.keys(json).forEach(function (key) {
                    if (Array.isArray(json[key]) && typeof(json[key][0]) === "object") {
                        json[key].forEach(function (o) {
                            _fixServerJSON(o);
                        });
                        return;
                    }

                    if (json[key] === null) {
                        json[key] = undefined;
                        return;
                    }

                    if (typeof(json[key]) === "object" && json[key] !== null) {
                        _fixServerJSON(json[key]);
                        return;
                    }

                    if (typeof json[key] === "string" && json[key].match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+\d{2}:\d{2})?$/)) {
                        json[key] = new Date(json[key]);
                    }
                });
            }

            function _calculateVotesPrecentage(voteData) {
                var totalVotes = voteData.TotalVotes,
                    totalPrecentage = 0,
                    answersVotes = [];

                voteData.Answers.forEach(function (answer) {
                    if (!voteData.IsShowVotes || totalVotes === 0) {
                        answer.VotesPrecentage = 0;
                        return;
                    }
                    var percentage = answer.Votes / totalVotes * 100;
                        answerPrecentage = {
                        "answer": answer,
                        "precentageRemain": percentage
                    };

                    answer.VotesPrecentage = Math.round(percentage);
                    answerPrecentage.precentageRemain -= answer.VotesPrecentage;
                    answersVotes.push(answerPrecentage);
                    totalPrecentage += answer.VotesPrecentage;
                });

                totalPrecentage = 100 - totalPrecentage;

                if (totalVotes !== 0 && totalPrecentage !== 0) {
                    answersVotes.sort(function (a, b) {
                        return totalPrecentage > 0 ? a.precentageRemain - b.precentageRemain : b.precentageRemain - a.precentageRemain;
                    });

                    while (totalPrecentage !== 0 && answersVotes.length > 0) {
                        var precentageDelta = totalPrecentage > 0 ?
                            Math.ceil(totalPrecentage / answersVotes.length) :
                            Math.floor(totalPrecentage / answersVotes.length),
                            answerPrecentage = answersVotes.pop();
                        answerPrecentage.answer.VotesPrecentage += precentageDelta;
                        totalPrecentage += precentageDelta * -1;
                    }
                }
            }

            function _formatDateString(date, format) {
                var result = format || "";

                result = result.replace(/dd/g, date.getDate().toString().padStart(2, "0"));
                result = result.replace(/d/g, date.getDate().toString());
                result = result.replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, "0"));
                result = result.replace(/M/g, (date.getMonth() + 1).toString());
                result = result.replace(/YYYY/g, date.getFullYear().toString());
                result = result.replace(/YY/g, (date.getFullYear() % 100).toString());
                result = result.replace(/HH/g, date.getHours().toString().padStart(2, "0"));
                result = result.replace(/H/g, date.getHours().toString());
                result = result.replace(/mm/g, date.getMinutes().toString().padStart(2, "0"));
                result = result.replace(/m/g, date.getMinutes().toString());
                result = result.replace(/SS/g, date.getSeconds().toString().padStart(2, "0"));
                result = result.replace(/S/g, date.getSeconds().toString());
                result = result.replace(/FFF/g, date.getMilliseconds().toString().padEnd(3, "0"));
                result = result.replace(/FF/g, Math.round(date.getMilliseconds() / 10).toString().padEnd(2, "0"));
                result = result.replace(/F/g, Math.round(date.getMilliseconds() / 100).toString());

                return result;
            }

            function _isAlreadyVoted(voteId) {
                var votesCookie = (GetCookie("one-votes") || "") + ",";

                return votesCookie.indexOf("," + voteId + ":") >= 0 || votesCookie.indexOf("," + voteId + ",") >= 0;
            }

            function _getVotedAnswer(voteId) {
                var votesCookie = (GetCookie("one-votes") || ""),
                    startIdxVoteData = votesCookie.indexOf("," + voteId + ":") + 1,
                    endIdxVoteData = votesCookie.indexOf(",", startIdxVoteData),
                    voteData,
                    answerId;

                voteData = votesCookie.substring(startIdxVoteData, endIdxVoteData).split(":");

                return voteData.length > 1 ? parseInt(voteData[1],10) : 0;
            }

            function _setCoockie(voteId, answerId) {

                if (!_isAlreadyVoted(voteId)) {
                    var votesCookie = GetCookie("one-votes") || ",";

                    if (answerId !== undefined) {
                        SetCookieDays("one-votes", votesCookie + voteId + ":" + answerId + ",", 30);
                    } else {
                        SetCookieDays("one-votes", votesCookie + voteId + ",", 30);
                    }
                }
            }

            function _showVotes($voteContainer, voteData) {

                // If there is new vote data update container data
                // else retrieve it from container
                if (voteData !== undefined) {
                    $voteContainer.data("vote", voteData);
                } else {
                    voteData = $voteContainer.data("vote");

                    // In case voteData not bind to $voteContainer.
                    // Try colect it from DOM elements.
                    if (voteData === undefined) {
                        voteData = {
                            "ID": $voteContainer.data("voteId"),
                            "IsShowVotes": $voteContainer.data("isShowVotes"),
                            "TotalVotes": parseInt($voteContainer.find(".total-votes").text(), 10),
                            "Answers": []
                        };

                        if (isNaN(voteData.TotalVotes)) {
                            voteData.TotalVotes = 0;
                        } else {
                            $voteContainer.find(".answer").each(function () {
                                var $answer = $(this);
                                voteData.Answers.push({
                                    "ID": parseInt($answer.data("answer-id"), 10),
                                    "Votes": parseInt($answer.data("answer-votes"), 10)
                                });
                            });
                            _calculateVotesPrecentage(voteData);
                            $voteContainer.data("vote", voteData);
                        }
                    }
                }

                var userAnsweredId = _getVotedAnswer(voteData.ID);

                $voteContainer
                    .addClass("voted")
                    .off("click", ".answer", _vote)
                    .find(".total-votes").text(voteData.TotalVotes);

                voteData.Answers.forEach(function (jsonAnswer, i) {
                    var votesPrecentage = jsonAnswer.VotesPrecentage + "%",
                        foundAnswer =
                            $.grep($voteContainer.find(".answer"), function (answer) {
                                return $(answer).data("answer-id") === jsonAnswer.ID;
                            }),
                        $answerContainer;

                    if (foundAnswer.length > 0) {
                        $answerContainer = $(foundAnswer[0]);

                        if (voteData.IsShowVotes) {
                            $answerContainer
                                .find(".percentage").text(votesPrecentage).end()
                                .find(".bar").css("width", votesPrecentage).end();
                        } else {
                            if (userAnsweredId === 0 && i === 0 ||
                                jsonAnswer.ID === userAnsweredId) {
                                $answerContainer
                                    .find(".text").text("הצבעתך נקלטה");
                            } else {
                                $answerContainer
                                    .find(".text").text("");
                            }
                        }

                        if (jsonAnswer.ImageID <= 0) {
                            $answerContainer.find(".answer-image-container").remove();
                        }
                    }
                });
            }

            function _vote() {
                var $btn = $(this),
                    $voteContainer = $btn.parents(".vote").eq(0),
                    voteId = $btn.data("vote-id"),
                    answerId = $btn.data("answer-id"),
                    params = {
                        "a": "vote",
                        "vId": voteId,
                        "aId": answerId
                    };

                if (_isAlreadyVoted(voteId)) {
                    _showVotes($voteContainer);
                    return;
                }

                $.ajax({
                    url: self.URL.Counter + "Cat/General/AjaxHandler.ashx",
                    data: params,
                    dataType: "jsonp",
                    contentType: "application/json; charset=utf-8"
                })
                    .done(function (voteData) {
                        if ($.isPlainObject(voteData)) {
                            if (voteData.Question !== undefined) {
                                _setCoockie(voteData.ID, answerId);
                                _fixServerJSON(voteData);
                                _calculateVotesPrecentage(voteData);
                                _showVotes($voteContainer, voteData);
                                $("#vote" + voteData.ID + "TV").text(voteData.TotalVotes);
                                $("#vote" + voteData.ID + "NV").text(voteData.NewVotes);
                            } else if (voteData.error === "ALREADY_VOTED") {
                                _setCoockie(voteId, answerId);
                                _showVotes($voteContainer);
                            } else if (voteData.error !== undefined) {
                                console.error(voteData.error);
                            }
                        }
                    })
                    .fail(function (jqXHR) {
                        if (jqXHR.status === 403) {
                            var response = JSON.parse(jqXHR.responseText);

                            if (response.error === "ALREADY_VOTED") {
                                _showVotes($voteContainer, answerId);
                                _setCoockie(voteId, answerId);
                            } else if (voteData.error !== undefined) {
                                console.error(voteData.error);
                            }
                        }
                    });
            }

            function _buildVoteUI($container, voteData) {
                var $voteContainer = $voteTamplate.clone(),
                    $answersContainer = $voteContainer.find(".answers"),
                    voteType;

                if (IsMobilePhone()) {
                    $container.addClass("mobile");
                }

                $voteContainer
                    .data("vote", voteData)
                    .on("click", ".answer", _vote);

                Object.keys(window.OneVote.VoteTypes).forEach(function (type) {
                    if ($container.hasClass(window.OneVote.VoteTypes[type])) {
                        voteType = window.OneVote.VoteTypes[type];
                    }
                });

                if (voteData.ImageID > 0) {
                    $voteContainer
                        .find(".vote-image").attr("src", _getImageURL(voteType, window.OneVote.ImageTypes.Vote, voteData.ImageURL)).end()
                        .find(".vote-image-credit").text(voteData.ImageCredit);
                } else {
                    $voteContainer.find(".vote-image").remove();
                }

                voteData.Answers.forEach(function (jsonAnswer) {
                    var $answerContainer = $answerTamplate.clone();

                    $answerContainer.data("vote-id", voteData.ID).data("answer-id", jsonAnswer.ID);

                    if (jsonAnswer.ImageID > 0) {
                        $answerContainer.find(".answer-image").attr("src", _getImageURL(voteType, window.OneVote.ImageTypes.Answer, jsonAnswer.ImageURL));
                    } else {
                        $answerContainer.find(".answer-image-container").remove();
                    }

                    $answerContainer
                        .find(".text").text(jsonAnswer.Text).end()
                        .appendTo($answersContainer);
                });

                if (_isAlreadyVoted(voteData.ID)) {
                    _showVotes($voteContainer, voteData);
                }

                $voteContainer
                    .find(".question").text(voteData.Question).end()
                    
                    .find(".date").text(_formatDateString(voteData.DateOpened, "dd/MM/YYYY")).end()
                    .find(".total-votes").text(voteData.TotalVotes).end()
                    .appendTo($container);
            }

            this.Init = function (selector) {
                var $votes = $(selector),
                    isJSgenerate = false;

                $votes.each(function () {
                    var $container = $(this),
                        voteId;
                    
                    if ($container.children().length === 0) {
                        isJSgenerate = true;
                    } else {
                        voteId = parseInt($container.data("vote-id"), 10);

                        if (!isNaN(voteId) && _isAlreadyVoted(voteId)) {
                            _showVotes($container);
                        }
                    }
                });

                if (isJSgenerate) {

                    $voteTamplate = $("<div>");
                    $voteTamplate.load(self.URL.Handler + "Cat/General/AjaxHandler.ashx?a=get-vote-dom&nomobileredirect=1 #vote-template",
                        function (responseText, textStatus) {
                            if (textStatus !== "success")
                                return;

                            _addIconsToBank($(responseText).filter(".icon-bank").children());
                            $voteTamplate = $voteTamplate.find(".vote.template").remove();
                            $answerTamplate = $voteTamplate.find(".answer.template").remove();
                            $voteTamplate.removeClass("template").removeAttr("id");
                            $answerTamplate.removeClass("template");

                            $votes.each(function () {
                                var $container = $(this),
                                    url = isJSONP ? self.URL.Handler + "Cat/General/AjaxHandler.ashx?nomobileredirect=1" : "/General/AjaxHandler/",
                                    params = {
                                        "a": "get-vote",
                                        "vId": $container.data("vote-id")
                                    };

                                if ($container.children().length > 0) {
                                    return;
                                }

                                $.ajax({
                                    url: url,
                                    type: "GET",
                                    data: params,
                                    dataType: isJSONP ? "jsonp" : "json",
                                    contentType: "application/json; charset=utf-8"
                                })
                                    .done(function (voteData, textStatus) {
                                        if (textStatus === "success" && $.isPlainObject(voteData)) {
                                            _fixServerJSON(voteData);
                                            _calculateVotesPrecentage(voteData);
                                            _buildVoteUI($container, voteData);
                                        }
                                    });

                            });

                        });
                }
            };

            this.VoteHandler = function () {
                return _vote;
            };
        };

        OneVote.prototype.URL = {
            "Handler": "//www.one.co.il/",
            "Counter": "https://www.one.co.il/"
        };

        OneVote.prototype.ImageTypes = {
            "Vote": 1,
            "Answer": 2
        };

        OneVote.prototype.VoteTypes = {
            "HomePage": "home-page",
            "Article": "article-vote"
        };

        return new OneVote();
    })();
    
}(window.jQuery));
////////////////////////////////////////////////////////////////////////////////////////////////////////
//  OneTrivia Class
//
//  To use it invoke window.OneTrivia.Init method and pass it jQuery selector for vote containers.
//  Each vote container must includ data-trivia-id attribute with Id of trivia you want to show.
//
//  Exemple:
//  <script>
//      $(function () {
//          window.OneTrivia.Init(".article-trivia")
//      });
//  </script>
//  <div class="article-trivia" data-trivia-id="1"></div>

(function ($) {
    window.OneTrivia = (function () {
        var OneTrivia = function () {
            var self = this,
                isJSONP = true,    ////////////////// Set this to false to disable JSONP requests
                $triviaTamplate,
                $questionTamplate,
                $answerTamplate;

            function _addIconsToBank($svg) {
                var $iconBank = $(".icon-bank");

                if ($iconBank.length < 1) {
                    $iconBank = $("<div class=\"icon-bank\" style=\"display:none;\" />").appendTo("body");
                }

                $svg.appendTo($iconBank);
            }

            function _getImageURL(imageType, ggNumber) {
                var url;

                switch (imageType) {
                    case window.OneTrivia.ImageTypes.Question:
                        url = "https://photo.one.co.il/Image/GG/7,1/" + ggNumber + ".jpg";
                        break;
                    case window.OneTrivia.ImageTypes.Answer:
                        url = "https://photo.one.co.il/Image/GG/2,1/" + ggNumber + ".jpg?width=181";
                        break;
                }

                return url;
            }

            function _fixServerJSON(json) {
                /// <summary>Converts null valeus to undefined and converts dates</summary>
                /// <param name="row" type="Object">JSON that represents row</param>
                /// <returns type="Object" />
                Object.keys(json).forEach(function (key) {
                    if (Array.isArray(json[key]) && typeof (json[key][0]) === "object") {
                        json[key].forEach(function (o) {
                            _fixServerJSON(o);
                        });
                        return;
                    }

                    if (json[key] === null) {
                        json[key] = undefined;
                        return;
                    }

                    if (typeof (json[key]) === "object" && json[key] !== null) {
                        _fixServerJSON(json[key]);
                        return;
                    }

                    if (typeof json[key] === "string" && json[key].match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\+\d{2}:\d{2})?$/)) {
                        json[key] = new Date(json[key]);
                    }
                });
            }

            function _formatDateString(date, format) {
                var result = format || "";

                result = result.replace(/dd/g, date.getDate().toString().padStart(2, "0"));
                result = result.replace(/d/g, date.getDate().toString());
                result = result.replace(/MM/g, (date.getMonth() + 1).toString().padStart(2, "0"));
                result = result.replace(/M/g, (date.getMonth() + 1).toString());
                result = result.replace(/YYYY/g, date.getFullYear().toString());
                result = result.replace(/YY/g, (date.getFullYear() % 100).toString());
                result = result.replace(/HH/g, date.getHours().toString().padStart(2, "0"));
                result = result.replace(/H/g, date.getHours().toString());
                result = result.replace(/mm/g, date.getMinutes().toString().padStart(2, "0"));
                result = result.replace(/m/g, date.getMinutes().toString());
                result = result.replace(/SS/g, date.getSeconds().toString().padStart(2, "0"));
                result = result.replace(/S/g, date.getSeconds().toString());
                result = result.replace(/FFF/g, date.getMilliseconds().toString().padEnd(3, "0"));
                result = result.replace(/FF/g, Math.round(date.getMilliseconds() / 10).toString().padEnd(2, "0"));
                result = result.replace(/F/g, Math.round(date.getMilliseconds() / 100).toString());

                return result;
            }

            function _selectQuestion(triviaData) {
                if (triviaData.ShownQuestions <= triviaData.QuestionsToShow) {
                    var questionIndex;

                    if (triviaData.IsRandomOrdered === false) {
                        questionIndex = 0;
                    } else {
                        questionIndex = Math.floor(Math.random() * triviaData.QuestionsIndexes.length);
                    }

                    questionIndex = triviaData.QuestionsIndexes.splice(questionIndex, 1);

                    if (questionIndex.length > 0) {
                        return triviaData.Questions[questionIndex[0]];
                    }
                }

                return null;
            }

            function _showTimer($triviaContainer, triviaData) {
                var minuts = Math.floor(triviaData.CurrentTime / 60),
                    seconds = triviaData.CurrentTime % 60,
                    barPercentage = Math.floor((triviaData.Timer - triviaData.CurrentTime) / triviaData.Timer * 100);

                $triviaContainer.find(".timer")
                    .find(".text .time").text(
                        minuts.toString().padStart(2, "0") + ":" +
                        seconds.toString().padStart(2, "0")).end()
                    .find(".bar").width(barPercentage + "%");

            }

            function _showProgress($container, triviaData) {
                $container
                    .find(".progress").text((triviaData.ShownQuestions).toString().padStart(2, "0") +
                        "/" + triviaData.QuestionsToShow.toString().padStart(2, "0"));
            }

            function _clearTimer(triviaData) {
                window.clearInterval(triviaData.IntervalId);
                triviaData.IntervalId = undefined;
                triviaData.CurrentTime = 0;
            }

            function _tick($triviaContainer, triviaData) {
                if (--triviaData.CurrentTime <= 0) {
                    _clearTimer(triviaData);
                    _showFinish($triviaContainer, triviaData);
                }

                _showTimer($triviaContainer, triviaData);
            }

            function _answer() {
                var $answer = $(this),
                    $questionContainer = $answer.parents(".question-container"),
                    $triviaContainer = $questionContainer.parents(".trivia"),
                    questionData = $questionContainer.children(".question").data("question"),
                    triviaData = $triviaContainer.data("trivia");

                triviaData.RightAnswers += questionData.ID === $answer.data("question-id") &&
                    questionData.RightAnswerId === $answer.data("answer-id") ? 1 : 0;

                if (triviaData.IntervalId === undefined) {
                    triviaData.IntervalId = window.setInterval(_tick, 1000, $triviaContainer, triviaData);
                }

                if (++triviaData.ShownQuestions <= triviaData.QuestionsToShow) {
                    _buildQuestionUI($questionContainer, _selectQuestion(triviaData));
                    _showTimer($triviaContainer, triviaData);
                    _showProgress($triviaContainer, triviaData);
                } else {
                    _showFinish($triviaContainer, triviaData);
                }
            }

            function _countViews(triviaId) {

                CountTriviaView(triviaId);
            }

            function _showFinish($triviaContainer, triviaData) {
                if (triviaData.IntervalId !== undefined) {
                    _clearTimer(triviaData);
                } 

                _countViews(triviaData.ID);
                
                var $finishContainer = $triviaContainer.children(".finish-container"),
                    score = (triviaData.RightAnswers).toString().padStart(2, "0") +
                        "/" + triviaData.QuestionsToShow.toString().padStart(2, "0"),
                    whatsappMessage = "https://wa.me/?text=" +
                        encodeURIComponent("הוצאתי " + score +
                            " בטריוויה של ONE: " + triviaData.Title + ".\nנראה אותך.\n" +
                            document.location.toString());
                      
                if (triviaData.ImageID > 0) {
                    $finishContainer
                        .find(".question-image").attr("src", _getImageURL(window.OneTrivia.ImageTypes.Question, triviaData.ImageID)).end()
                        .find(".question-image-credit").text(triviaData.ImageCredit);
                } else {
                    $finishContainer.find(".question-image-container").remove();
                }

                $finishContainer
                    .find(".right-answers").text(score).end()
                    .find(".whatsapp").attr("href", whatsappMessage);

                $triviaContainer.children(".question-container,.finish-container").toggle();
            }

            function _buildQuestionUI($container, questionData) {
                var $questionContainer = $questionTamplate.clone(),
                    $answersContainer = $questionContainer.find(".answers");

                $questionContainer
                    .data("question", questionData)
                    .on("click", ".answer", _answer);

                if (questionData.ImageID > 0) {
                    $questionContainer
                        .find(".question-image").attr("src", _getImageURL(window.OneTrivia.ImageTypes.Question, questionData.ImageID)).end()
                        .find(".question-image-credit").text(questionData.ImageCredit);
                } else {
                    $questionContainer.find(".question-image-container")
                        .after($questionContainer.find(".progress")).remove();
                }

                questionData.Answers.forEach(function (answerData) {
                    var $answerContainer = $answerTamplate.clone();

                    $answerContainer
                        .data("question-id", questionData.ID)
                        .data("answer-id", answerData.ID);

                    if (answerData.ImageID > 0) {
                        $answerContainer.find(".answer-image").attr("src", _getImageURL(window.OneTrivia.ImageTypes.Answer, answerData.ImageID));
                    } else {
                        $answerContainer.find(".answer-image-container").remove();
                    }

                    $answerContainer
                        .find(".text").text(answerData.Text);

                    if (Math.ceil(Math.random() * 4) % 2 > 0) {
                        $answerContainer.appendTo($answersContainer);
                    } else {
                        $answerContainer.prependTo($answersContainer);
                    }
                });

                $questionContainer
                    .find(".question-text").text(questionData.Text).end()
                    .appendTo($container.empty());
            }

            function _buildTriviaUI($container, triviaData) {
                var $triviaContainer = $triviaTamplate.clone(),
                    $questionContainer = $triviaContainer.find(".question-container"),
                    $finishContainer = $triviaContainer.find(".finish-container");

                if (IsMobilePhone() && !$container.hasClass("mobile")) {
                    $container.addClass("mobile");
                }

                _buildQuestionUI($questionContainer, _selectQuestion(triviaData));
                _showTimer($triviaContainer, triviaData);
                _showProgress($triviaContainer, triviaData);

                if (triviaData.FinishText.trim().length > 0) {
                    if (triviaData.FinishURL.trim().length > 0) {
                        $("<a target=\"_blank\"/>")
                            .attr("href", triviaData.FinishURL)
                            .text(triviaData.FinishText)
                            .appendTo($finishContainer.find(".finish-text"));
                    } else {
                        $finishContainer.find(".finish-text")
                            .text(triviaData.FinishText);
                    }
                }

                $finishContainer
                    .find(".restart")
                    .click({
                        "$container": $container,
                        "triviaData": triviaData
                    }, _restart);

                $triviaContainer
                    .data("trivia", triviaData)
                    .find(".trivia-title").text(triviaData.Title).end()
                    .find(".date").text(_formatDateString(triviaData.DateOpened, "dd/MM/YYYY")).end()
                    .find(".total-participants").text(triviaData.Views).end()
                    .appendTo($container.empty())
                    .show();
            }

            function _restart(event) {
                _startTrivia(event.data.$container, event.data.triviaData);
            }

            function _startTrivia($container, triviaData) {
                $.extend(triviaData, {
                    "ShownQuestions": 1,
                    "RightAnswers": 0,
                    "IntervalId": undefined,
                    "CurrentTime": triviaData.Timer,
                    "QuestionsIndexes": [],
                    "QuestionsToShow": triviaData.QuestionsToShow > 0 ?
                        triviaData.QuestionsToShow : triviaData.Questions.length
                });

                for (var i = 0; i < triviaData.Questions.length; i++) {
                    triviaData.QuestionsIndexes.push(i);
                }

                _buildTriviaUI($container, triviaData);
                $container.find(".finish-container").hide();
            }

            this.Init = function (selector) {
                var $trivias = $(selector);

                if ($trivias.length === 0) {
                    return;
                }

                $triviaTamplate = $("<div>");
                $triviaTamplate.load(self.URL.Handler + "Cat/General/AjaxHandler.ashx?a=get-trivia-dom&nomobileredirect=1 #trivia-template",
                    function (responseText, textStatus) {
                        if (textStatus !== "success")
                            return;

                        _addIconsToBank($(responseText).filter(".icon-bank").children());
                        $triviaTamplate = $triviaTamplate.find(".trivia.template").remove();
                        $questionTamplate = $triviaTamplate.find(".question.template").remove();
                        $answerTamplate = $questionTamplate.find(".answer.template").remove();
                        $triviaTamplate.removeClass("template").removeAttr("id");
                        $questionTamplate.removeClass("template");
                        $answerTamplate.removeClass("template");

                        $trivias.each(function () {
                            var $container = $(this),
                                url = isJSONP ? self.URL.Handler + "Cat/General/AjaxHandler.ashx?nomobileredirect=1" : "/General/AjaxHandler/",
                                params = {
                                    "a": "get-trivia",
                                    "tId": $container.data("trivia-id")
                                };

                            if ($container.children().length > 0) {
                                return;
                            }

                            $.ajax({
                                url: url,
                                type: "GET",
                                cache: true,
                                data: params,
                                dataType: isJSONP ? "jsonp" : "json",
                                jsonpCallback: "getTriviaData",
                                contentType: "application/json; charset=utf-8"
                            })
                                .done(function (triviaData, textStatus) {
                                    if (textStatus === "success" && $.isPlainObject(triviaData)) {
                                        _fixServerJSON(triviaData);
                                        _startTrivia($container, triviaData);
                                    }
                                });
                        });

                    });
            };

            this.VoteHandler = function () {
                return _vote;
            };
        };

        OneTrivia.prototype.URL = {
            "Handler": "//www.one.co.il/",
            "Counter": "//www.one.co.il/"
        };

        OneTrivia.prototype.ImageTypes = {
            "Question": 1,
            "Answer": 2
        };

        return new OneTrivia();
    })();


}(window.jQuery));



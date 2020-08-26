const electron = require("electron");
const url = require("url");
const fetch = require("electron-fetch").default;
const path = require("path");
const fs = require("fs").promises;
const cheerio = require("cheerio");
const Store = require("electron-store");
const PouchDB = require("pouchdb");

const { app, BrowserWindow, ipcMain, session } = electron;

// ================================================================================================
// GLOBALS
// ================================================================================================
let mainWindow;
const DB = Object.freeze({
  ITEM_CATEGORIES: new PouchDB("categories"),
  ITEMS: new PouchDB("vine-items"),
  _STORE: new Store({
    schema: {
      categories: {
        type: "object",
        properties: {
          update_time: {
            type: "number",
            minimum: 604800000, // ONE WEEK
            default: 604800000, // ONE WEEK
          },
          last_update: {
            type: "string",
            default: "January 1, 1970 00:00:00 UTC",
          },
        },
        default: {},
      },
      items: {
        type: "object",
        properties: {
          update_time: {
            type: "number",
            minimum: 86400000, // ONE DAY
            default: 86400000, // ONE DAY
          },
          last_update: {
            type: "string",
            default: "January 1, 1970 00:00:00 UTC",
          },
        },
        default: {},
      },
    },
  }),
});
const URL = Object.freeze({
  APP_INIT: `file:///${path.join(__dirname, "components/init/init.html")}`,
  APP_PAGE: `file:///${path.join(__dirname, "components/base/base.html")}`,
  AMAZON_VINE: "https://www.amazon.com/vine/vine-items",
  AMAZON_LOGIN: "https://www.amazon.com/gp/sign-in.html",
  AMAZON_AUTH: "https://www.amazon.com/ap/cvf/approval",
  AMAZON_HOME: "https://www.amazon.com/gp/css/homepage.html",
  AMAZON_ITEM: "https://www.amazon.com/vine/api/recommendations",
});
const QUEUE = Object.freeze({
  RECOMMENDED: "potluck",
  AVAILABLE_FOR_ALL: "last_chance",
  ADDITIONAL_ITEMS: "encore",
});
const DIR = Object.freeze({
  IMG_CACHE: path.join(__dirname, "cache"),
});
const SETTINGS = new Store({
  schema: {
    settings: {
      type: "object",
      properties: {
        max_threads: {
          type: "number",
          minimum: 1,
          maximum: 50,
          default: 5,
        },
      },
      default: {},
    },
  },
});

// ================================================================================================
// INITIALIZATION FUNCTIONS
// ================================================================================================
/**
 * Create main window.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 780,
    title: "Amazon Vine Tools",
    webPreferences: {
      nodeIntegration: true,
    },
    frame: false,
    minWidth: 1240,
  });
}

// ================================================================================================
// LOGIN FUNCTIONS
// ================================================================================================
/**
 * Handle checking if the user is logged in to Amazon.
 */
function handleLoginCheck() {
  mainWindow.webContents.loadURL(URL.AMAZON_VINE);

  // Check the (Potentially) Redirected Url
  mainWindow.webContents.on("did-navigate", (event, site) => {
    console.log("Checking if user logged in.");
    console.log("Current Site: " + site);
    const parsed = url.parse(site);
    // If already logged in, you can access the Vine page.
    if (parsed.pathname !== url.parse(URL.AMAZON_VINE).pathname) {
      // Determine which part of the login process you are at
      console.log("User is not Logged In");
      handleLoginStep(parsed);
    } else {
      console.log("User is Logged In");
      // Clear listeners - already logged in
      mainWindow.webContents.removeAllListeners("did-navigate");
      // Load App Page
      mainWindow.webContents.loadURL(URL.APP_PAGE);
    }
  });
}

/**
 * Handle each step of the login process to Amazon until the user is successfully logged in.
 * @param {UrlWithStringQuery} parsed The parsed website URL.
 */
function handleLoginStep(parsed) {
  // Webpage is not amazon - Redirect to Login Page
  if (parsed.host !== "www.amazon.com") {
    console.log("Bad Host: " + parsed.host);
    mainWindow.webContents.loadURL(URL.AMAZON_LOGIN);
  }
  // Login Process
  if (parsed.pathname === url.parse(URL.AMAZON_LOGIN).pathname) {
    console.log("User Must Sign In");
  } else if (parsed.pathname === url.parse(URL.AMAZON_AUTH).pathname) {
    console.log("User Must Authenticate Sign In");
  } else if (parsed.pathname === url.parse(URL.AMAZON_HOME).pathname) {
    console.log("User is Signed In");
    mainWindow.webContents.loadURL(URL.AMAZON_VINE);
  }
}

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================
/**
 * Get current Electron session cookies from the application.
 * @returns Cookies from the current session as a string.
 */
async function getSessionCookies() {
  const cookies = await session.defaultSession.cookies.get({});
  const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  return cookieString;
}

/**
 * Sleep for specified amount of time.
 * @param {uint} ms Amount of time to sleep in miliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Generate random float from the min value to the max value.
 * @param {float} min Smallest value that the random float can be.
 * @param {float} max Largest value that the random float can be.
 */
function generateRandomNumber(min, max) {
  const random = Math.random() * (max - min) + min;
  return random.toFixed(3);
}

// ================================================================================================
// DATA RETRIEVAL FUNCTIONS
// ================================================================================================
/**
 * Retrieve webpage HTML containing Vine items from Amazon.
 * @param {string} queue
 * @param {uint} size Total amount of items to retrieve on the page
 * @param {uint} page Page to retrieve items from.
 * @param {Map} optParams Additional optional parameters added to the query of the URL.
 * @returns Object containing the Vine HTML page and the URL used to request the data.
 */
async function getVinePageFromAmazon(queue, size, page, optParams = {}) {
  console.log("Retrieving HTML Page from Amazon...");
  const reqUrl = url.format({
    host: URL.AMAZON_VINE,
    query: { queue: queue, size: size, page: page, ...optParams },
  });
  console.log(`[GET VINE PAGE] ${reqUrl}`);

  const cookies = await getSessionCookies();
  const response = await fetch(reqUrl, {
    session: session.defaultSession,
    headers: {
      cookie: cookies,
      "user-agent": mainWindow.webContents.userAgent,
    },
  });

  return { url: reqUrl, html: await response.text() };
}

async function scrapeVineCategories(event) {
  const vp = await getVinePageFromAmazon(QUEUE.AVAILABLE_FOR_ALL, 1, 1);
  const page = cheerio.load(vp.html);
  const categoryContainer = page("#vvp-browse-nodes-container");

  event.sender.send("update:category", "Scraping Amazon vine category pages...");
  const categories = categoryContainer
    .find(".parent-node > a")
    .map((_, element) => {
      const link = element.attribs["href"];
      const parentNodeId = new URLSearchParams(link).get("pn");
      const itemCount = categoryContainer
        .find(element)
        .parent()
        .find("span")
        .text()
        .replace(/\D/g, "");
      const category = {
        name: categoryContainer.find(element).text(),
        nodeId: parentNodeId,
        itemCount: parseInt(itemCount),
        subcategories: null,
      };
      return category;
    })
    .toArray();

  for (category of categories) {
    const wait = generateRandomNumber(1, 1.5);
    console.log(`Waiting for ${wait} seconds...`);
    await sleep(wait * 1000);
    console.log(`Category: ${category.name} | Scraping subcategories...`);
    event.sender.send("update:category", `Scraping subcategories of ${category.name}...`);
    category.subcategories = await scrapeVineSubcategories(category.nodeId);
  }

  return categories;
}

async function scrapeVineSubcategories(parentNodeId) {
  const vp = await getVinePageFromAmazon(QUEUE.AVAILABLE_FOR_ALL, 1, 1, { pn: parentNodeId });
  const page = cheerio.load(vp.html);
  const categoryContainer = page("#vvp-browse-nodes-container");

  const subcategories = categoryContainer
    .find(".child-node > a")
    .map((_, element) => {
      const link = element.attribs["href"];
      const childNodeId = new URLSearchParams(link).get("cn");
      const itemCount = categoryContainer
        .find(element)
        .parent()
        .find("span")
        .text()
        .replace(/\D/g, "");
      const subcategory = {
        name: categoryContainer.find(element).text(),
        nodeId: childNodeId,
        itemCount: parseInt(itemCount),
      };
      return subcategory;
    })
    .toArray();

  return subcategories;
}

async function scrapeVinePage(html) {
  console.log("Scraping Vine HTML Page...");
  const page = cheerio.load(html);
  const itemGrid = page("#vvp-items-grid");
  // Scrape Item Grid
  const scrapedItems = itemGrid
    .find(".vvp-item-tile")
    .map((_, element) => {
      const fullId = element.attribs["data-recommendation-id"];
      const [unknownSegment1, query, asin, unknownSegment2] = fullId.split("#");
      const item = {
        _id: fullId,
        query: query,
        asin: asin,
        productName: itemGrid.find(element).find(".a-truncate-full").text(),
        thumbnail: element.attribs["data-img-url"],
      };
      console.log(JSON.stringify(item));
      return item;
    })
    .toArray();

  // Download Item Thumbnail Image And Use Cached Version
  for (const item of scrapedItems) {
    const thumbnailFilepath = path.join(DIR.IMG_CACHE, item.thumbnail.split("/").pop());
    await fs
      .access(thumbnailFilepath)
      .then(() => console.log("Thumbnail already exists, skipping..."))
      .catch(async () => await updateThumbnail(thumbnailFilepath, item.thumbnail));
    item.thumbnail = thumbnailFilepath;
  }

  console.log(`Total Scraped Items: ${scrapedItems.length}`);
  return scrapedItems;
}

async function updateThumbnail(filepath, imgUrl) {
  console.log(`Downloading Resource From ${imgUrl} To ${filepath}`);
  const response = await fetch(imgUrl);
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(filepath, Buffer.from(arrayBuffer), { encoding: null });
  console.log(`Successfully saved resource ${filepath}`);
}

/**
 * Retrieve the complete item data for a product.
 * @param {Object} scrapedItem Incomplete Amazon Vine product scraped from the HTML.
 * @return Additional item data as a JSON object.
 */
async function getVineItemData(scrapedItem, referer = null) {
  const itemId = encodeURIComponent(scrapedItem.id);
  const itemAsin = encodeURIComponent(scrapedItem.asin);
  const reqUrl = `${URL.AMAZON_ITEM}/${itemId}/item/${itemAsin}`;
  console.log(reqUrl);

  const cookies = await getSessionCookies();

  const response = await fetch(reqUrl, {
    session: session.defaultSession,
    headers: {
      cookie: cookies,
      pragma: "no-cache",
      referer: referer,
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "cache-control": "no-cache",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": mainWindow.webContents.userAgent,
    },
    useElectronNet: true,
  });

  if (response.status !== 200) {
    console.log(response.statusText);
    throw new Error("Failed to Retrieve Item Data");
  }

  const jsonString = await response.text();
  const json = JSON.parse(jsonString);

  if (json["error"] !== null) {
    console.log("Error ");
    throw new Error(JSON.stringify(json["error"]));
  } else if (json["result"] == null) {
    throw new Error(`No Result Set in JSON Response\n${jsonString}`);
  }

  return json["result"];
}

// ================================================================================================
// BACKEND EVENT HANDLER FUNCTIONS
// ================================================================================================

ipcMain.handle("check-update:categories", async (event) => {
  try {
    const lastUpdate = new Date(DB._STORE.get("categories.last_update"));
    const updateWait = DB._STORE.get("categories.update_time");
    const updateTime = lastUpdate.valueOf() + updateWait;
    const canUpdate = Date.now() >= updateTime;
    console.log();
    console.log(`Category Last Updated: ${lastUpdate}`);
    console.log(`Amount of time before another update is possible: ${updateWait} ms`);
    console.log(`Category data earliest update date: ${new Date(updateTime)}`);
    console.log(`Category data ${canUpdate ? "can" : "can't"} be updated`);
    return {
      error: false,
      canUpdate: canUpdate,
      msg: `Category database is ${canUpdate ? "" : "not"} ready for an update.`,
    };
  } catch (error) {
    console.log(error);
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("update-db:categories", async (event) => {
  try {
    console.log();
    console.log("Update Database Categories");
    const categories = await scrapeVineCategories(event);
    categories.forEach((category) => (category._id = category["name"]));
    event.sender.send("update:category", "Updating the Category database...");
    return await DB.ITEM_CATEGORIES.bulkDocs(categories)
      .then(console.log("Updated Database Categories."))
      .then(DB._STORE.set("categories.last_update", new Date().toDateString()))
      .finally(() => {
        event.sender.send("update:category", "Successfully updated Vine category info");
        return { error: false, msg: "Successfully updated Vine category info" };
      });
  } catch (error) {
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("check-update:items", async (event) => {
  try {
    const lastUpdate = new Date(DB._STORE.get("items.last_update"));
    const updateWait = DB._STORE.get("items.update_time");
    const updateTime = lastUpdate.valueOf() + updateWait;
    const canUpdate = Date.now() >= updateTime;
    console.log();
    console.log(`Items Last Updated: ${lastUpdate}`);
    console.log(`Amount of time before another update is possible: ${updateWait} ms`);
    console.log(`Item data earliest update date: ${new Date(updateTime)}`);
    console.log(`Item data ${canUpdate ? "can" : "can't"} be updated`);
    return {
      error: false,
      canUpdate: canUpdate,
      msg: `Item database is ${canUpdate ? "" : "not"} ready for an update.`,
    };
  } catch (error) {
    console.log(error);
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("update-db:items", async (event) => {
  try {
    // Unlist all old items. If some items are still available, they will
    // be remarked as listed later.
    console.log("Setting items as unlisted...");
    const itemDocs = await DB.ITEMS.allDocs({ include_docs: true });
    const oldItems = itemDocs.rows.map((x) => x.doc);
    oldItems.forEach((item) => {
      item.listed = false;
    });
    DB.ITEMS.bulkDocs(console.log("Marked all old items as unlisted."));

    // Get Categories
    console.log("\n", "Retrieving updated data from amazon...");
    const categoryDocs = await DB.ITEM_CATEGORIES.allDocs({ include_docs: true });
    const categories = categoryDocs.rows.map((x) => x.doc);

    // Determine the total number of listed items
    const totalItems = categories
      .map((category) =>
        category.subcategories
          .map((subcategory) => subcategory.itemCount)
          .reduce((prev, curr) => prev + curr)
      )
      .reduce((prev, current, _) => prev + current);

    console.log(`Total Amazon Items Avaiable: ${totalItems}`);

    // Progress Bar current Item / Total Items
    let itemProgress = 0;
    for (category of categories) {
      for (subcategory of category["subcategories"]) {
        const wait = generateRandomNumber(0.5, 1.5);
        console.log("\n", `Waiting for ${wait}`);
        await sleep(wait * 1000);
        console.log(
          "\n",
          `Getting category pages for ${category["name"]} > ${subcategory["name"]}`
        );

        // Get Vine Page
        const page = 1;
        const vp = await getVinePageFromAmazon(
          QUEUE.AVAILABLE_FOR_ALL,
          subcategory["itemCount"],
          page,
          {
            pn: category["nodeId"],
            cn: subcategory["nodeId"],
          }
        );

        // Scrape Items from Vine HTML
        const scrapedItems = await scrapeVinePage(vp.html);

        // Add Items to Database With Additional Info
        console.log("\n", `Updating Database with ${scrapedItems.length} Items`);
        for (i = 0; i < scrapedItems.length; i++) {
          //const additionalItemData = await getVineItemData(scrapedItems[i], vp.url);
          itemProgress++;
          const item = {
            ...scrapedItems[i],
            category: category["name"],
            subcategory: subcategory["name"],
            position: i + 1,
            listed: true,
          };
          await DB.ITEMS.put(item)
            .then(event.sender.send("update:item", item, itemProgress, totalItems))
            .catch((error) => {
              DB.ITEMS.get(item._id).then((doc) => DB.ITEMS.put({ ...item, _rev: doc._rev }));
            });
        }
      }
    }
    DB._STORE.set("items.last_update", new Date().toDateString());
    console.log(`=> Successfully retrieved updated data from Amazon`);
    return {
      error: false,
      msg: `Successfully retrieved ${totalItems} Updated Amazon Vine Products.`,
    };
  } catch (error) {
    console.log(`=> Failed to retrieve updated data from Amazon ${error.message}`);
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("fetch-db:categories", async (event) => {
  try {
    console.log("\n", "Fetching categories from database...");
    return await DB.ITEM_CATEGORIES.allDocs({ include_docs: true })
      .then((result) => result.rows.map((row) => row.doc))
      .then((categories) => {
        return {
          error: false,
          categories: categories,
          msg: "Successfully retrieved all categories from database.",
        };
      });
  } catch (error) {
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("fetch-db:items", async (event) => {
  try {
    console.log("\n", "Fetching items from database...");
    return await DB.ITEMS.allDocs({ include_docs: true })
      .then((result) => result.rows.map((row) => row.doc))
      .then((items) => {
        return {
          error: false,
          items: items.filter((x) => x.listed), // Only retrieve the currently listed items
          msg: "Successfully retrieved all items from database.",
        };
      });
  } catch (error) {
    return { error: true, msg: error.message };
  }
});

ipcMain.handle("fetch-settings", async (event) => {
  try {
    console.log("\n", "Fetching application settings...");
    return {
      error: false,
      settings: SETTINGS.store.settings,
      msg: "Successfully retrieved settings!",
    };
  } catch (error) {
    return { error: false, msg: error.message };
  }
});

ipcMain.handle("wipe-db:items", async (event) => {
  console.log("\n", "Wiping the Items database...");
  return await DB.ITEMS.destroy()
    .then(() => {
      DB.ITEMS = new PouchDB("vine-items");
    })
    .then(DB._STORE.reset("items"))
    .then(() => {
      return { error: false, msg: "Successfully reset the Item database" };
    })
    .catch((error) => {
      return { error: true, msg: error.message };
    });
});

// Starts the application
app.whenReady().then(createWindow).then(handleLoginCheck);

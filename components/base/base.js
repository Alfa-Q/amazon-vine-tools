/**
 * TODO:
 *  - LAZY LOAD IMAGES TO IMPROVE SPEED
 *  - INCREASE LOAD TIME BY REMOVING POPUPS IF APP WAS ALREADY RUN
 *  - GET ADDITIONAL INFORMATION FOR ITEMS IN THE BACKGROUND WITHOUT AMAZON BANNING
 *  - FIX ISSUE WHERE CATEGORY COUNT IS NOT BEING UPDATED CORRECTLY AFTER RETRIEVING NEW
 *    ITEMS (this is because categories are not re-scraped when the items are re-scraped
 *    which makes the category item count out of sync)
 */

// Load Bootstrap and JQuery
// This fixes an electron bug where importing these scripts via HTML tag causes an error to occur.
window.$ = window.jQuery = require("jquery");
window.Bootstrap = require("bootstrap");

const ipcRenderer = require("electron").ipcRenderer;
const Swal = require("sweetalert2");
const url = require("url");
const List = require("list.js");

// Constants
const CACHED_ELEMENTS = {};
const ICON_ERROR = 0x274c;
const ICON_SUCCESS = 0x2714;
const ICON_RETRY = 0x1f504;
const ITEMS_PER_PAGE = 60; // The standard amount of items on each amazon page.
const VIEW_MAP = {
  "btn-search": {
    title: "SEARCH AMAZON ITEMS",
    id: "search",
  },
  "btn-bookmarks": {
    title: "MY BOOKMARKS",
    id: "bookmarks",
  },
  "btn-settings": {
    title: "SETTINGS",
    html: "settings",
  },
};
const ITEM_LIST_OPTS = {
  pagination: true,
  page: 0, // overwritten by settings later
  valueNames: [
    "productName",
    "category",
    "subcategory",
    "page",
    "position",
    { name: "thumbnail", attr: "src" },
    { name: "link", attr: "href" },
  ],
  // This describes how items must look like in HTML
  item: `<li class="media my-2 border rounded border-secondary">
      <img class="mr-3 img-thumbnail thumbnail" src="" loading="lazy" width="125px" height="125px" />
      <div class="media-body">
        <div class="productName display-6 mt-2 mb-1"></div>
        <div class="mt-auto">
          <div class="category badge badge-primary"></div> &gt; 
          <div class="subcategory badge badge-secondary"></div> &gt; 
          <div class="badge badge-info">
            Page <div class="page d-inline-block"></div>
          </div> &gt; 
          <div class="badge badge-info">
            Position <div class="position d-inline-block"></div>
          </div>
        </div>
        <a class="link" href="" target="_blank">View In Amazon</a>
      </div>
    </li>`,
};

// State Variables
let settings;
let navigationBtn; // Current navigation page.
let categories = [];
let itemList;
let page = 1;
let scrolling = false;

// ================================================================================================
// INITIALIZATION FUNCTIONS
// ================================================================================================
window.addEventListener("load", async () => {
  if ("loading" in HTMLImageElement.prototype) {
    // supported in browser
    console.log("Supports Lazy Loading!");
  }

  initView();

  // Retrieve App Settings
  var result = await fetchSettings();
  settings = result.settings;

  // Use settings
  ITEM_LIST_OPTS.page = settings["items_per_page"];

  // Check if category db can be updated
  var result = await checkCategoryDb();
  await sleep(6000);
  if (!result.error && result.canUpdate) {
    await updateCategoryDb();
    await sleep(6000);
  } else {
    $("#toast-2").remove();
  }

  // Load Categories
  // TODO: Store category info on update similar to how items are stored
  var result = await fetchCategories();
  if (!result.error) {
    categories = result.categories;
    console.log(categories);
    updateCategoryDropdown();
  }

  // Check if item db can be updated
  const itemDb = await checkItemDb();
  await sleep(6000);
  if (!itemDb.error && itemDb.canUpdate) {
    await updateItemDb();
    await sleep(6000);
  } else {
    $("#toast-4").remove();
  }

  // Load Items
  var result = await fetchItems();
  if (!result.error) {
    const items = result.items;
    console.log(items);
    createItemList(items);
  }
});

$(document).on("ready", (event) => {
  $(".btn").mousedown((e) => {
    e.preventDefault();
  });
});

function initView() {
  console.log("Loaded Base JS.  Loading View...");
  // Set currently selected button to "search"
  navigationBtn = $("#btn-search");
  // Update the title of the body
  $("#main-title").text("SEARCH AMAZON ITEMS");
  // Disable currently selected button
  navigationBtn.prop("disabled", true);
}

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateItemUrl(pn, cn, position) {
  // Create URL that only displays the item.
  // TODO: Fix bug where this does not work (sometimes shows wrong item)
  //       This may actually be an Amazon issue, as their product count
  //       tends to be inaccurate.
  return url.format({
    host: "https://www.amazon.com/vine/vine-items",
    query: { queue: "last_chance", size: 1, pn: pn, cn: cn, page: position },
  });
}

function ellipsify(str, maxlen) {
  if (str.length > maxlen) {
    return str.substring(0, maxlen) + "...";
  } else {
    return str;
  }
}

function tryRevertElementState(jqueryElement) {
  const id = jqueryElement.attr("id");
  if (CACHED_ELEMENTS[id] !== undefined) {
    // Set current html of the element to old html
    const html = CACHED_ELEMENTS[id].html();
    jqueryElement.html(html);
  } else {
    // Cache the element current state
    CACHED_ELEMENTS[id] = jqueryElement;
  }
}

function chunkify(arr, len) {
  var chunks = [],
    i = 0,
    n = arr.length;
  while (i < n) {
    chunks.push(arr.slice(i, (i += len)));
  }
  return chunks;
}

// ================================================================================================
// VIEW FUNCTIONS
// ================================================================================================
setInterval(() => {
  // Infinite Scroll Using Pagination
  if (scrolling) {
    const container = $("#items-container");
    const containerPosY = container.height(); // Y position of the container top
    const scrollPosY = container.scrollTop(); // Scroll position Y

    const containerList = $("#items-container > .list");
    const containerListY = containerList.height(); // Container list height size

    if (scrollPosY + containerPosY > containerListY - 100) {
      console.log("Loading More Items!");
      page++;
      itemList.show(0, page * settings["items_per_page"]);
    } else if (scrollPosY + containerPosY < containerPosY + 100) {
      console.log("REACHED TOP!");
    }
    scrolling = false;
  }
}, 250);

function scrollHandler() {
  scrolling = true;
}

function updateView(btn) {
  console.log("Navigation Changed: Update View");
  const btnID = btn.getAttribute("id");
  const button = $(`#${btnID}`).prop("disabled", true);
  navigationBtn.prop("disabled", false);
  navigationBtn = button;
  $("#main-body").load(VIEW_MAP[btnID]["id"]);
  $("#main-title").text(VIEW_MAP[btnID]["title"]);
}

function updateToast(
  toast,
  { icon = null, iconIsEmoji = true, title = null, body = null, muted = null }
) {
  if (icon) {
    toast.find(".toast-icon").empty();
    if (iconIsEmoji) {
      toast.find(".toast-icon").text(String.fromCodePoint(icon));
    } else {
      toast.find(".toast-icon").html(icon);
    }
  }
  if (title) {
    toast.find(".toast-title > strong").text(title);
  }
  if (body) {
    toast.find(".toast-body").text(body);
    // toast.find(".toast-body").html().replace(/\n/g, "<br/>");
  }
  if (muted) {
    toast.find(".text-muted").text(muted);
  }
}

function handleError(result, toast, toastTitle, toastMsg, retry) {
  // Display Error Popup and Show Failure in Toast
  console.log(`Show Error to Display! ${result.msg}`);
  setTimeout(() => {
    Swal.fire({
      title: "An Error Occurred!",
      text: `${result.msg}`,
      icon: "error",
      showCancelButton: true,
      confirmButtonText: "Retry",
      cancelButtonText: "Cancel",
    }).then(async (result) => {
      if (result.value) {
        await retry();
      }
    });
    updateToast(toast, {
      icon: ICON_ERROR,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
}

function handleOk(toast, toastTitle, toastMsg) {
  // Update Toast and Hide Toast
  setTimeout(() => {
    updateToast(toast, {
      icon: ICON_SUCCESS,
      title: toastTitle,
      body: toastMsg,
    });
  }, 2500);
  setTimeout(() => {
    toast.toast("hide");
    toast.remove();
  }, 5000);
}

// ================================================================================================
// SEARCH AND FILTER FUNCTIONS
// ================================================================================================
function createItemList(items) {
  console.log("Creating Item List");
  itemList = new List("items-container", ITEM_LIST_OPTS);

  items.map((item) => {
    // Generate fields and extract info to be placed in the HTML
    const page = Math.ceil(item.position / ITEMS_PER_PAGE);
    const category = categories.filter((category) => category.name === item.category)[0];
    const subcategory = category.subcategories.filter(
      (subcategory) => subcategory.name === item.subcategory
    )[0];
    const itemPageUrl = generateItemUrl(category.nodeId, subcategory.nodeId, item.position);
    return {
      ...item,
      page: page,
      link: itemPageUrl,
    };
  });

  itemList.add(items, () => {
    console.log(`Created Item List: ${itemList}`);
    updateSearchInfo(itemList.items.length);
  });
}

function searchForm() {
  applyFilter();
  // For hitting enter in the form
  return false;
}

function applyFilter() {
  // Page is reset to the start page
  page = 1;

  // Collapse Filter
  $("#collapseBody").collapse("hide");

  // Remove old Filters
  itemList.filter();

  // Extract Filter Values
  const query = $("#filter-search").val().toLowerCase();
  let category = $("#filter-category").val();
  let subcategory = $("#filter-subcategory").val();
  //const minTaxValue = parseInt($("#tax-value-min").val()) || 0;
  //const maxTaxValue = parseInt($("#tax-value-max").val()) || 2147483647;
  //const minRating = parseInt($("#min-rating").val()) || 0;

  // Perform Filter
  itemList.filter((item) => {
    const values = item.values();
    return (
      values.productName.toLowerCase().includes(query) &&
      (values.category === category || category === "default") &&
      (values.subcategory === subcategory || subcategory == "default")
      //item.taxValue >= minTaxValue &&
      //item.taxValue <= maxTaxValue &&
      //item.avgRating >= minRating
    );
  });

  // Extract Sort Method
  const method = $("#order-by").val();
  const direction = $("#order-direction").val();

  console.log(`Sort Method: ${method} | Direction: ${direction}`);

  // Sort Items
  itemList.sort(method, { order: direction });

  // Update Search Info
  console.log(itemList.matchingItems);
  updateSearchInfo(itemList.matchingItems.length);

  // Scroll back to top
  $("#items-container").scrollTop(0);
}

function clearFilter() {
  console.log("Clearing Filter!");
  $("#filter-search").val("");
  $("#filter-category").val("default");
  // $("#tax-value-min").val("");
  // $("#tax-value-max").val("");
  // $("#min-rating").val("Any");

  $("#order-by").val("productName");
  $("#order-direction").val("desc");
  filteredItems = items;
  updateItemsContainer(items);
}

function updateSearchInfo(itemsFound) {
  // Change Search Result Number
  $("#search-info > div").text(`Search Results: ${itemsFound} Items Found`);
}

async function updateCategoryDropdown() {
  console.log("Updating Categories Dropdown List!");
  const categoryDropdown = $("#filter-category");
  const subcategoryDropdown = $("#filter-subcategory");
  categories.forEach((category) => {
    // Add the option to the category dropdown list (Force DOM to Update)
    setTimeout(() => {
      categoryDropdown.append(
        `<option value="${category.name}">${category.name} (${category.itemCount})</option>`
      );
    }, 0);
  });

  // Add event when selection changed to this category - update list of subcategories
  categoryDropdown.on("change", (event) => {
    var currentCategory = categoryDropdown.val();
    console.log(`Category Is Changed To ${currentCategory}`);
    const category = categories.filter((category) => category.name === currentCategory)[0];
    console.log(category);

    // Clear Subcategory and Add Default Option
    subcategoryDropdown.html("");
    subcategoryDropdown.append(`<option value="default" selected="">All</option>`);

    // Add Each Subcategory
    category.subcategories.forEach((subcategory) => {
      setTimeout(() => {
        subcategoryDropdown.append(
          `<option value="${subcategory.name}">${subcategory.name}</option>`
        );
      }, 0);
    });
  });
}

// ================================================================================================
// BACKEND FUNCTIONS
// ================================================================================================
async function checkCategoryDb() {
  // Display Toast
  const notification = $("#toast-1");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Category database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Category database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(
      notification,
      `Category Database ${result.canUpdate ? "Needs Update" : "OK"}`,
      result.msg
    );
  }

  return result;
}

async function updateCategoryDb() {
  // Display Toast
  const notification = $("#toast-2");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Retrieving Data...</span></div>`,
    iconIsEmoji: false,
    title: "Updating Category Database",
    body: `It's time for an update!  Updating the Category database...`,
  });
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:categories");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Category Database",
      "Failed to update the category database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Category Database", result.msg);
  }

  return result;
}

async function checkItemDb() {
  // Display Toast
  const notification = $("#toast-3");
  updateToast(notification, {
    icon: `<div class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span></div>`,
    iconIsEmoji: false,
    title: "Checking For Update",
    body: `Checking if the Item database needs an update...`,
  });
  notification.toast("show");

  // Determine if Can Update
  const result = await ipcRenderer.invoke("check-update:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Checking For Update",
      "Failed to determine if the Item database could be updated.",
      checkCategoryDb
    );
  } else {
    // Show Success in Toast and Then Hide Toast
    handleOk(notification, `Item Database ${result.canUpdate ? "Needs Update" : "OK"}`, result.msg);
  }

  return result;
}

async function updateItemDb() {
  // Display Toast
  const notification = $("#toast-4");
  tryRevertElementState(notification);
  notification.toast("show");

  // Retrieve Results
  const result = await ipcRenderer.invoke("update-db:items");
  console.log(`Result: ${JSON.stringify(result)}`);
  if (result.error) {
    handleError(
      result,
      notification,
      "Error: Updating Item Database",
      "Failed to update the item database.",
      updateCategoryDb
    );
  } else {
    handleOk(notification, "Updated Item Database", result.msg);
  }

  return result;
}

async function fetchCategories() {
  // Fetch Categories
  const result = await ipcRenderer.invoke("fetch-db:categories");
  return result;
}

async function fetchItems() {
  // Fetch All Items
  const result = await ipcRenderer.invoke("fetch-db:items");
  console.log(result);
  return result;
}

async function fetchSettings() {
  const result = await ipcRenderer.invoke("fetch-settings");
  console.log(result);
  return result;
}

// ================================================================================================
// EVENT HANDLER FUNCTIONS
// ================================================================================================
ipcRenderer.on("update:category", (event, message) => {
  const notification = $("#toast-2");
  updateToast(notification, { body: message });
});

ipcRenderer.on("update:item", async (event, item, current, total) => {
  // Update Toast
  const notification = $("#toast-4");
  const completion = current / total;
  const message = `Got Item: ${ellipsify(item.productName, 40)}`;
  updateToast(notification, { muted: `${current}/${total}` });
  notification.find(".item-info").text(message);
  notification.find(".badge-primary").text(item.category);
  notification.find(".badge-secondary").text(item.subcategory);
  $("#toast-4 .progress-bar").attr("style", `width: ${completion * 100}%;`);
});

// ================================================================================================
// DEV FUNCTIONS
// ================================================================================================
async function wipeItemsDb(unlistedOnly = false) {
  const result = await ipcRenderer.invoke("wipe-db:items");
  console.log(result);
  location.reload();
}

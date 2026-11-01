// First import of every sub-page entry (download, changelog, legal, 404): the CSS in the right order, then initPage().
// Same contract as the landing: site/base.css, site/foundation.css, then page CSS. Never import ../styles.css here.
import "../base.css";
import "../foundation.css";
import "./pages.css";
import { initPage } from "../ui";

initPage();
